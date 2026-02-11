;; title: agent-registry
;; version: 1.0.0
;; summary: AI Agent identity and capability registry for Stacks
;; description: First AI agent infrastructure on Stacks. Agents register with
;;              capabilities, pricing, and delegate wallets. Foundation layer
;;              for the agent-vault, task-board, and reputation contracts.

;; ============================================================================
;; CONSTANTS
;; ============================================================================

(define-constant ERR-ALREADY-REGISTERED (err u1000))
(define-constant ERR-NOT-REGISTERED (err u1001))
(define-constant ERR-UNAUTHORIZED (err u1002))
(define-constant ERR-NAME-TOO-LONG (err u1003))
(define-constant ERR-TOO-MANY-CAPS (err u1004))
(define-constant ERR-INVALID-STATUS (err u1005))
(define-constant ERR-NOT-DELEGATE (err u1006))

(define-constant MAX-NAME-LEN u64)
(define-constant MAX-CAPS u8)
(define-constant STATUS-ACTIVE u1)
(define-constant STATUS-PAUSED u2)
(define-constant STATUS-DEREGISTERED u3)

;; ============================================================================
;; STATE
;; ============================================================================

(define-data-var total-agents uint u0)
(define-data-var admin principal tx-sender)
(define-data-var pending-admin (optional principal) none)

;; ============================================================================
;; MAPS
;; ============================================================================

;; Core agent record
(define-map agents
  { owner: principal }
  {
    name: (string-utf8 64),
    description-url: (string-utf8 256),
    status: uint,
    registered-at: uint,
    total-tasks: uint,
    total-earned: uint,
    price-per-task: uint,
    accepts-stx: bool,
    accepts-sip010: bool
  }
)

;; Capabilities indexed 0-7 per agent
(define-map agent-capabilities
  { owner: principal, index: uint }
  { capability: (string-utf8 64) }
)

;; Delegate wallets authorized to act on behalf of an agent
(define-map delegates
  { owner: principal, delegate: principal }
  { active: bool, granted-at: uint }
)

;; ============================================================================
;; PUBLIC FUNCTIONS
;; ============================================================================

;; Register a new agent
(define-public (register-agent
    (name (string-utf8 64))
    (description-url (string-utf8 256))
    (price-per-task uint)
    (accepts-stx bool)
    (accepts-sip010 bool)
  )
  (begin
    (asserts! (is-none (map-get? agents { owner: tx-sender })) ERR-ALREADY-REGISTERED)
    (asserts! (<= (len name) MAX-NAME-LEN) ERR-NAME-TOO-LONG)

    (map-set agents { owner: tx-sender } {
      name: name,
      description-url: description-url,
      status: STATUS-ACTIVE,
      registered-at: stacks-block-height,
      total-tasks: u0,
      total-earned: u0,
      price-per-task: price-per-task,
      accepts-stx: accepts-stx,
      accepts-sip010: accepts-sip010
    })

    (var-set total-agents (+ (var-get total-agents) u1))

    (print {
      event: "agent-registered",
      owner: tx-sender,
      name: name,
      price-per-task: price-per-task
    })

    (ok tx-sender)
  )
)

;; Update agent metadata (owner only)
(define-public (update-agent
    (name (string-utf8 64))
    (description-url (string-utf8 256))
    (price-per-task uint)
    (accepts-stx bool)
    (accepts-sip010 bool)
  )
  (let
    (
      (agent (unwrap! (map-get? agents { owner: tx-sender }) ERR-NOT-REGISTERED))
    )
    (asserts! (<= (len name) MAX-NAME-LEN) ERR-NAME-TOO-LONG)

    (map-set agents { owner: tx-sender } (merge agent {
      name: name,
      description-url: description-url,
      price-per-task: price-per-task,
      accepts-stx: accepts-stx,
      accepts-sip010: accepts-sip010
    }))

    (print { event: "agent-updated", owner: tx-sender })
    (ok true)
  )
)

;; Set a capability at a given index (0-7)
(define-public (set-capability (index uint) (capability (string-utf8 64)))
  (begin
    (asserts! (is-some (map-get? agents { owner: tx-sender })) ERR-NOT-REGISTERED)
    (asserts! (< index MAX-CAPS) ERR-TOO-MANY-CAPS)

    (map-set agent-capabilities
      { owner: tx-sender, index: index }
      { capability: capability }
    )

    (print { event: "capability-set", owner: tx-sender, index: index, capability: capability })
    (ok true)
  )
)

;; Remove a capability at a given index
(define-public (remove-capability (index uint))
  (begin
    (asserts! (is-some (map-get? agents { owner: tx-sender })) ERR-NOT-REGISTERED)
    (asserts! (< index MAX-CAPS) ERR-TOO-MANY-CAPS)

    (map-delete agent-capabilities { owner: tx-sender, index: index })

    (print { event: "capability-removed", owner: tx-sender, index: index })
    (ok true)
  )
)

;; Set agent status (active, paused, deregistered)
(define-public (set-status (new-status uint))
  (let
    (
      (agent (unwrap! (map-get? agents { owner: tx-sender }) ERR-NOT-REGISTERED))
    )
    (asserts! (or (is-eq new-status STATUS-ACTIVE)
                  (is-eq new-status STATUS-PAUSED)
                  (is-eq new-status STATUS-DEREGISTERED))
              ERR-INVALID-STATUS)

    (map-set agents { owner: tx-sender } (merge agent { status: new-status }))

    (print { event: "status-changed", owner: tx-sender, status: new-status })
    (ok new-status)
  )
)

;; Add a delegate wallet
(define-public (add-delegate (delegate principal))
  (begin
    (asserts! (is-some (map-get? agents { owner: tx-sender })) ERR-NOT-REGISTERED)

    (map-set delegates
      { owner: tx-sender, delegate: delegate }
      { active: true, granted-at: stacks-block-height }
    )

    (print { event: "delegate-added", owner: tx-sender, delegate: delegate })
    (ok true)
  )
)

;; Remove a delegate wallet
(define-public (remove-delegate (delegate principal))
  (begin
    (asserts! (is-some (map-get? agents { owner: tx-sender })) ERR-NOT-REGISTERED)

    (map-set delegates
      { owner: tx-sender, delegate: delegate }
      { active: false, granted-at: stacks-block-height }
    )

    (print { event: "delegate-removed", owner: tx-sender, delegate: delegate })
    (ok true)
  )
)

;; Increment task count and earnings (called by task-board contract)
(define-public (record-task-completion (agent principal) (earned uint))
  (let
    (
      (record (unwrap! (map-get? agents { owner: agent }) ERR-NOT-REGISTERED))
    )
    ;; Only admin or authorized contracts can call this
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)

    (map-set agents { owner: agent } (merge record {
      total-tasks: (+ (get total-tasks record) u1),
      total-earned: (+ (get total-earned record) earned)
    }))

    (ok true)
  )
)

;; ============================================================================
;; ADMIN FUNCTIONS
;; ============================================================================

;; Two-step admin transfer
(define-public (transfer-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (var-set pending-admin (some new-admin))
    (print { event: "admin-transfer-initiated", new-admin: new-admin })
    (ok new-admin)
  )
)

(define-public (accept-admin)
  (let
    (
      (pending (unwrap! (var-get pending-admin) ERR-UNAUTHORIZED))
    )
    (asserts! (is-eq tx-sender pending) ERR-UNAUTHORIZED)
    (var-set admin pending)
    (var-set pending-admin none)
    (print { event: "admin-transferred", admin: pending })
    (ok pending)
  )
)

;; ============================================================================
;; READ-ONLY FUNCTIONS
;; ============================================================================

(define-read-only (get-agent (owner principal))
  (map-get? agents { owner: owner })
)

(define-read-only (get-capability (owner principal) (index uint))
  (map-get? agent-capabilities { owner: owner, index: index })
)

(define-read-only (is-registered (owner principal))
  (is-some (map-get? agents { owner: owner }))
)

(define-read-only (is-active (owner principal))
  (match (map-get? agents { owner: owner })
    agent (is-eq (get status agent) STATUS-ACTIVE)
    false
  )
)

(define-read-only (is-delegate (owner principal) (delegate principal))
  (match (map-get? delegates { owner: owner, delegate: delegate })
    d (get active d)
    false
  )
)

(define-read-only (get-admin)
  (var-get admin)
)

(define-read-only (get-pending-admin)
  (var-get pending-admin)
)

(define-read-only (get-stats)
  {
    total-agents: (var-get total-agents),
    admin: (var-get admin)
  }
)
