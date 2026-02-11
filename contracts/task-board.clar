;; title: task-board
;; version: 1.0.0
;; summary: Task marketplace with STX escrow for AI agents on Stacks
;; description: Post tasks with STX bounties, agents bid, fulfill, and get paid.
;;              Includes dispute resolution with admin arbitration.
;;              Escrow held by contract. Calls reputation on completion/dispute.
;;              Uses Clarity 4 as-contract? with explicit asset allowances.

;; ============================================================================
;; CONSTANTS
;; ============================================================================

(define-constant ERR-TASK-NOT-FOUND (err u1200))
(define-constant ERR-UNAUTHORIZED (err u1201))
(define-constant ERR-INVALID-STATUS (err u1202))
(define-constant ERR-ALREADY-BID (err u1203))
(define-constant ERR-NOT-ASSIGNED (err u1204))
(define-constant ERR-ZERO-BOUNTY (err u1205))
(define-constant ERR-SELF-ASSIGN (err u1206))
(define-constant ERR-NOT-REGISTERED (err u1207))
(define-constant ERR-DISPUTE-WINDOW (err u1208))
(define-constant ERR-ALREADY-DISPUTED (err u1209))
(define-constant ERR-NOT-ADMIN (err u1210))
(define-constant ERR-TASK-EXPIRED (err u1211))
(define-constant ERR-INVALID-FEE (err u1212))
(define-constant ERR-SPLIT-MISMATCH (err u1213))
(define-constant ERR-NO-BID (err u1214))
(define-constant ERR-TITLE-TOO-LONG (err u1215))
(define-constant ERR-CONTRACT-CALL (err u1216))

(define-constant TASK-OPEN u1)
(define-constant TASK-ASSIGNED u2)
(define-constant TASK-SUBMITTED u3)
(define-constant TASK-COMPLETED u4)
(define-constant TASK-DISPUTED u5)
(define-constant TASK-CANCELLED u6)
(define-constant TASK-EXPIRED u7)

(define-constant DISPUTE-WINDOW u72)
(define-constant MAX-TITLE-LEN u128)
(define-constant MAX-FEE-BPS u1000)

;; ============================================================================
;; STATE
;; ============================================================================

(define-data-var total-tasks uint u0)
(define-data-var fee-bps uint u0)
(define-data-var admin principal tx-sender)
(define-data-var fee-recipient principal tx-sender)
(define-data-var pending-admin (optional principal) none)

;; ============================================================================
;; MAPS
;; ============================================================================

;; Task records
(define-map tasks
  { id: uint }
  {
    poster: principal,
    title: (string-utf8 128),
    description-url: (string-utf8 256),
    bounty: uint,
    fee: uint,
    assigned-to: (optional principal),
    status: uint,
    created-at: uint,
    deadline: uint,
    submitted-at: uint,
    completed-at: uint,
    result-url: (string-utf8 256)
  }
)

;; Bids on tasks
(define-map bids
  { task-id: uint, bidder: principal }
  {
    price: uint,
    message-url: (string-utf8 256),
    bid-at: uint
  }
)

;; Bid enumeration index
(define-map bid-index
  { task-id: uint, index: uint }
  { bidder: principal }
)

;; Bid count per task
(define-map task-bid-count
  { task-id: uint }
  { count: uint }
)

;; Attestation guard -- written on completion for reputation contract to read
(define-map task-attestation-guard
  { task-id: uint }
  { agent: principal, poster: principal }
)

;; ============================================================================
;; PUBLIC FUNCTIONS
;; ============================================================================

;; Post a task with STX escrow
(define-public (post-task
    (title (string-utf8 128))
    (description-url (string-utf8 256))
    (bounty uint)
    (deadline uint)
  )
  (let
    (
      (task-id (var-get total-tasks))
      (fee (calc-fee bounty))
      (total-escrow (+ bounty fee))
      (caller tx-sender)
      ;; Get contract address using as-contract? with no asset allowances
      (self (unwrap! (as-contract? () tx-sender) ERR-CONTRACT-CALL))
    )
    (asserts! (> bounty u0) ERR-ZERO-BOUNTY)
    (asserts! (<= (len title) MAX-TITLE-LEN) ERR-TITLE-TOO-LONG)

    ;; Transfer bounty + fee to contract as escrow
    (try! (stx-transfer? total-escrow caller self))

    ;; Create task record
    (map-set tasks { id: task-id } {
      poster: caller,
      title: title,
      description-url: description-url,
      bounty: bounty,
      fee: fee,
      assigned-to: none,
      status: TASK-OPEN,
      created-at: stacks-block-height,
      deadline: deadline,
      submitted-at: u0,
      completed-at: u0,
      result-url: u""
    })

    (var-set total-tasks (+ task-id u1))

    (print {
      event: "task-posted",
      task-id: task-id,
      poster: caller,
      bounty: bounty,
      fee: fee,
      deadline: deadline
    })

    (ok task-id)
  )
)

;; Bid on a task (registered agents only)
(define-public (bid
    (task-id uint)
    (price uint)
    (message-url (string-utf8 256))
  )
  (let
    (
      (task (unwrap! (map-get? tasks { id: task-id }) ERR-TASK-NOT-FOUND))
      (bid-count-data (default-to { count: u0 } (map-get? task-bid-count { task-id: task-id })))
      (current-count (get count bid-count-data))
    )
    ;; Must be registered agent
    (asserts! (contract-call? .agent-registry is-registered tx-sender) ERR-NOT-REGISTERED)
    ;; Task must be open
    (asserts! (is-eq (get status task) TASK-OPEN) ERR-INVALID-STATUS)
    ;; Can't bid on own task
    (asserts! (not (is-eq tx-sender (get poster task))) ERR-SELF-ASSIGN)
    ;; Can't bid twice
    (asserts! (is-none (map-get? bids { task-id: task-id, bidder: tx-sender })) ERR-ALREADY-BID)

    ;; Record bid
    (map-set bids
      { task-id: task-id, bidder: tx-sender }
      { price: price, message-url: message-url, bid-at: stacks-block-height }
    )

    ;; Add to bid index
    (map-set bid-index
      { task-id: task-id, index: current-count }
      { bidder: tx-sender }
    )
    (map-set task-bid-count
      { task-id: task-id }
      { count: (+ current-count u1) }
    )

    (print { event: "bid-placed", task-id: task-id, bidder: tx-sender, price: price })
    (ok true)
  )
)

;; Assign task to a bidding agent (poster only)
(define-public (assign (task-id uint) (agent principal))
  (let
    (
      (task (unwrap! (map-get? tasks { id: task-id }) ERR-TASK-NOT-FOUND))
    )
    ;; Poster only
    (asserts! (is-eq tx-sender (get poster task)) ERR-UNAUTHORIZED)
    ;; Task must be open
    (asserts! (is-eq (get status task) TASK-OPEN) ERR-INVALID-STATUS)
    ;; Agent must have bid
    (asserts! (is-some (map-get? bids { task-id: task-id, bidder: agent })) ERR-NO-BID)
    ;; Can't assign to self
    (asserts! (not (is-eq agent (get poster task))) ERR-SELF-ASSIGN)

    (map-set tasks { id: task-id } (merge task {
      assigned-to: (some agent),
      status: TASK-ASSIGNED
    }))

    (print { event: "task-assigned", task-id: task-id, agent: agent })
    (ok true)
  )
)

;; Submit completed work (assigned agent only)
(define-public (submit-work (task-id uint) (result-url (string-utf8 256)))
  (let
    (
      (task (unwrap! (map-get? tasks { id: task-id }) ERR-TASK-NOT-FOUND))
      (assigned (unwrap! (get assigned-to task) ERR-NOT-ASSIGNED))
    )
    ;; Must be assigned agent
    (asserts! (is-eq tx-sender assigned) ERR-UNAUTHORIZED)
    ;; Task must be assigned
    (asserts! (is-eq (get status task) TASK-ASSIGNED) ERR-INVALID-STATUS)

    (map-set tasks { id: task-id } (merge task {
      status: TASK-SUBMITTED,
      submitted-at: stacks-block-height,
      result-url: result-url
    }))

    (print { event: "work-submitted", task-id: task-id, agent: tx-sender })
    (ok true)
  )
)

;; Approve work and release payment (poster only)
(define-public (approve (task-id uint))
  (let
    (
      (task (unwrap! (map-get? tasks { id: task-id }) ERR-TASK-NOT-FOUND))
      (agent (unwrap! (get assigned-to task) ERR-NOT-ASSIGNED))
      (bounty (get bounty task))
      (fee (get fee task))
    )
    ;; Poster only
    (asserts! (is-eq tx-sender (get poster task)) ERR-UNAUTHORIZED)
    ;; Must be submitted
    (asserts! (is-eq (get status task) TASK-SUBMITTED) ERR-INVALID-STATUS)

    ;; Pay agent the bounty
    (unwrap! (as-contract? ((with-stx bounty))
      (try! (stx-transfer? bounty tx-sender agent))
    ) ERR-CONTRACT-CALL)

    ;; Pay fee to fee-recipient (if any)
    (if (> fee u0)
      (unwrap! (as-contract? ((with-stx fee))
        (try! (stx-transfer? fee tx-sender (var-get fee-recipient)))
      ) ERR-CONTRACT-CALL)
      true
    )

    ;; Update task
    (map-set tasks { id: task-id } (merge task {
      status: TASK-COMPLETED,
      completed-at: stacks-block-height
    }))

    ;; Write attestation guard for reputation
    (map-set task-attestation-guard
      { task-id: task-id }
      { agent: agent, poster: (get poster task) }
    )

    ;; Record completion in reputation
    (try! (contract-call? .reputation record-completion task-id agent (get poster task)))

    (print { event: "task-approved", task-id: task-id, agent: agent, bounty: bounty })
    (ok true)
  )
)

;; Dispute submitted work (poster only, within dispute window)
(define-public (dispute (task-id uint) (reason-url (string-utf8 256)))
  (let
    (
      (task (unwrap! (map-get? tasks { id: task-id }) ERR-TASK-NOT-FOUND))
      (agent (unwrap! (get assigned-to task) ERR-NOT-ASSIGNED))
    )
    ;; Poster only
    (asserts! (is-eq tx-sender (get poster task)) ERR-UNAUTHORIZED)
    ;; Must be submitted
    (asserts! (is-eq (get status task) TASK-SUBMITTED) ERR-INVALID-STATUS)
    ;; Within dispute window
    (asserts! (<= (- stacks-block-height (get submitted-at task)) DISPUTE-WINDOW) ERR-DISPUTE-WINDOW)

    (map-set tasks { id: task-id } (merge task {
      status: TASK-DISPUTED
    }))

    ;; Record dispute in reputation
    (try! (contract-call? .reputation record-dispute agent))

    (print { event: "task-disputed", task-id: task-id, poster: tx-sender, reason-url: reason-url })
    (ok true)
  )
)

;; Resolve dispute with split (admin only)
(define-public (resolve-dispute
    (task-id uint)
    (pay-agent uint)
    (refund-poster uint)
  )
  (let
    (
      (task (unwrap! (map-get? tasks { id: task-id }) ERR-TASK-NOT-FOUND))
      (agent (unwrap! (get assigned-to task) ERR-NOT-ASSIGNED))
      (bounty (get bounty task))
      (fee (get fee task))
      (poster (get poster task))
    )
    ;; Admin only
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    ;; Must be disputed
    (asserts! (is-eq (get status task) TASK-DISPUTED) ERR-INVALID-STATUS)
    ;; Split must equal bounty
    (asserts! (is-eq (+ pay-agent refund-poster) bounty) ERR-SPLIT-MISMATCH)

    ;; Pay agent their portion
    (if (> pay-agent u0)
      (unwrap! (as-contract? ((with-stx pay-agent))
        (try! (stx-transfer? pay-agent tx-sender agent))
      ) ERR-CONTRACT-CALL)
      true
    )

    ;; Refund poster their portion
    (if (> refund-poster u0)
      (unwrap! (as-contract? ((with-stx refund-poster))
        (try! (stx-transfer? refund-poster tx-sender poster))
      ) ERR-CONTRACT-CALL)
      true
    )

    ;; Pay fee to fee-recipient
    (if (> fee u0)
      (unwrap! (as-contract? ((with-stx fee))
        (try! (stx-transfer? fee tx-sender (var-get fee-recipient)))
      ) ERR-CONTRACT-CALL)
      true
    )

    ;; Update task
    (map-set tasks { id: task-id } (merge task {
      status: TASK-COMPLETED,
      completed-at: stacks-block-height
    }))

    ;; Write attestation guard
    (map-set task-attestation-guard
      { task-id: task-id }
      { agent: agent, poster: poster }
    )

    ;; Record completion in reputation
    (try! (contract-call? .reputation record-completion task-id agent poster))

    (print {
      event: "dispute-resolved",
      task-id: task-id,
      pay-agent: pay-agent,
      refund-poster: refund-poster
    })
    (ok true)
  )
)

;; Cancel an open task and refund escrow (poster only)
(define-public (cancel (task-id uint))
  (let
    (
      (task (unwrap! (map-get? tasks { id: task-id }) ERR-TASK-NOT-FOUND))
      (total-escrow (+ (get bounty task) (get fee task)))
      (poster (get poster task))
    )
    ;; Poster only
    (asserts! (is-eq tx-sender poster) ERR-UNAUTHORIZED)
    ;; Must be open (not assigned/submitted/etc)
    (asserts! (is-eq (get status task) TASK-OPEN) ERR-INVALID-STATUS)

    ;; Refund full escrow (bounty + fee)
    (unwrap! (as-contract? ((with-stx total-escrow))
      (try! (stx-transfer? total-escrow tx-sender poster))
    ) ERR-CONTRACT-CALL)

    (map-set tasks { id: task-id } (merge task {
      status: TASK-CANCELLED
    }))

    (print { event: "task-cancelled", task-id: task-id })
    (ok true)
  )
)

;; Expire a past-deadline unassigned task (anyone can call)
(define-public (expire-task (task-id uint))
  (let
    (
      (task (unwrap! (map-get? tasks { id: task-id }) ERR-TASK-NOT-FOUND))
      (total-escrow (+ (get bounty task) (get fee task)))
      (poster (get poster task))
    )
    ;; Must be open
    (asserts! (is-eq (get status task) TASK-OPEN) ERR-INVALID-STATUS)
    ;; Must be past deadline
    (asserts! (>= stacks-block-height (get deadline task)) ERR-TASK-EXPIRED)

    ;; Refund escrow to poster
    (unwrap! (as-contract? ((with-stx total-escrow))
      (try! (stx-transfer? total-escrow tx-sender poster))
    ) ERR-CONTRACT-CALL)

    (map-set tasks { id: task-id } (merge task {
      status: TASK-EXPIRED
    }))

    (print { event: "task-expired", task-id: task-id })
    (ok true)
  )
)

;; ============================================================================
;; ADMIN FUNCTIONS
;; ============================================================================

;; Set protocol fee (max 10%)
(define-public (set-fee (new-fee-bps uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (asserts! (<= new-fee-bps MAX-FEE-BPS) ERR-INVALID-FEE)
    (var-set fee-bps new-fee-bps)
    (print { event: "fee-updated", fee-bps: new-fee-bps })
    (ok new-fee-bps)
  )
)

;; Set fee recipient
(define-public (set-fee-recipient (new-recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (var-set fee-recipient new-recipient)
    (print { event: "fee-recipient-updated", recipient: new-recipient })
    (ok new-recipient)
  )
)

;; Two-step admin transfer
(define-public (transfer-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (var-set pending-admin (some new-admin))
    (print { event: "admin-transfer-initiated", new-admin: new-admin })
    (ok new-admin)
  )
)

(define-public (accept-admin)
  (let
    (
      (pending (unwrap! (var-get pending-admin) ERR-NOT-ADMIN))
    )
    (asserts! (is-eq tx-sender pending) ERR-NOT-ADMIN)
    (var-set admin pending)
    (var-set pending-admin none)
    (print { event: "admin-transferred", admin: pending })
    (ok pending)
  )
)

;; ============================================================================
;; READ-ONLY FUNCTIONS
;; ============================================================================

(define-read-only (get-task (id uint))
  (map-get? tasks { id: id })
)

(define-read-only (get-bid (task-id uint) (bidder principal))
  (map-get? bids { task-id: task-id, bidder: bidder })
)

(define-read-only (get-bid-at (task-id uint) (index uint))
  (map-get? bid-index { task-id: task-id, index: index })
)

(define-read-only (get-bid-count (task-id uint))
  (default-to { count: u0 } (map-get? task-bid-count { task-id: task-id }))
)

(define-read-only (get-attestation (task-id uint))
  (map-get? task-attestation-guard { task-id: task-id })
)

(define-read-only (get-fee-bps)
  (var-get fee-bps)
)

(define-read-only (get-fee-recipient)
  (var-get fee-recipient)
)

(define-read-only (get-admin)
  (var-get admin)
)

(define-read-only (get-stats)
  {
    total-tasks: (var-get total-tasks),
    fee-bps: (var-get fee-bps),
    admin: (var-get admin)
  }
)

;; ============================================================================
;; PRIVATE FUNCTIONS
;; ============================================================================

;; Calculate fee from bounty amount
(define-private (calc-fee (amount uint))
  (/ (* amount (var-get fee-bps)) u10000)
)
