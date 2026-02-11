;; title: reputation
;; version: 1.0.0
;; summary: On-chain reputation system for AI agents on Stacks
;; description: Tracks ratings (1-5), endorsements, task completions, and disputes.
;;              Task-board contract calls record-completion and record-dispute.
;;              Ratings validated via internal completion map (no circular dependency).

;; ============================================================================
;; CONSTANTS
;; ============================================================================

(define-constant ERR-NOT-AUTHORIZED (err u1300))
(define-constant ERR-ALREADY-RATED (err u1301))
(define-constant ERR-INVALID-SCORE (err u1302))
(define-constant ERR-SELF-ENDORSEMENT (err u1303))
(define-constant ERR-NOT-REGISTERED (err u1304))
(define-constant ERR-NO-ATTESTATION (err u1305))
(define-constant ERR-TASK-MISMATCH (err u1306))

(define-constant MIN-SCORE u1)
(define-constant MAX-SCORE u5)

;; ============================================================================
;; STATE
;; ============================================================================

(define-data-var admin principal tx-sender)
(define-data-var pending-admin (optional principal) none)
(define-data-var task-board-contract principal tx-sender)

;; ============================================================================
;; MAPS
;; ============================================================================

;; Aggregated reputation per agent
(define-map agent-reputation
  { agent: principal }
  {
    total-score: uint,
    rating-count: uint,
    tasks-completed: uint,
    tasks-disputed: uint,
    endorsement-count: uint
  }
)

;; Individual ratings: one per task per rater
(define-map ratings
  { task-id: uint, rater: principal }
  {
    agent: principal,
    score: uint,
    block: uint
  }
)

;; Endorsements: one per endorser-agent pair
(define-map endorsements
  { endorser: principal, agent: principal }
  {
    capability: (string-utf8 64),
    block: uint
  }
)

;; Task completion records -- populated by record-completion, read by rate-agent
;; Breaks circular dependency: reputation reads its own map, not task-board
(define-map task-completions
  { task-id: uint }
  { agent: principal, poster: principal }
)

;; ============================================================================
;; PUBLIC FUNCTIONS
;; ============================================================================

;; Rate an agent after task completion (poster only)
;; Validates via internal task-completions map (no cross-contract call to task-board)
(define-public (rate-agent
    (task-id uint)
    (agent principal)
    (score uint)
  )
  (let
    (
      (completion (unwrap! (map-get? task-completions { task-id: task-id }) ERR-NO-ATTESTATION))
    )
    ;; Validate score range
    (asserts! (>= score MIN-SCORE) ERR-INVALID-SCORE)
    (asserts! (<= score MAX-SCORE) ERR-INVALID-SCORE)

    ;; Validate caller is the task poster
    (asserts! (is-eq tx-sender (get poster completion)) ERR-NOT-AUTHORIZED)

    ;; Validate agent matches completion record
    (asserts! (is-eq agent (get agent completion)) ERR-TASK-MISMATCH)

    ;; Check not already rated
    (asserts! (is-none (map-get? ratings { task-id: task-id, rater: tx-sender })) ERR-ALREADY-RATED)

    ;; Record rating
    (map-set ratings
      { task-id: task-id, rater: tx-sender }
      { agent: agent, score: score, block: stacks-block-height }
    )

    ;; Update aggregated reputation
    (let
      (
        (rep (default-to
          { total-score: u0, rating-count: u0, tasks-completed: u0, tasks-disputed: u0, endorsement-count: u0 }
          (map-get? agent-reputation { agent: agent })
        ))
      )
      (map-set agent-reputation { agent: agent } (merge rep {
        total-score: (+ (get total-score rep) score),
        rating-count: (+ (get rating-count rep) u1)
      }))
    )

    (print { event: "agent-rated", task-id: task-id, agent: agent, rater: tx-sender, score: score })
    (ok true)
  )
)

;; Endorse an agent's capability (any registered agent can endorse)
(define-public (endorse (agent principal) (capability (string-utf8 64)))
  (begin
    ;; Must be registered to endorse
    (asserts! (contract-call? .agent-registry is-registered tx-sender) ERR-NOT-REGISTERED)
    ;; Can't endorse yourself
    (asserts! (not (is-eq tx-sender agent)) ERR-SELF-ENDORSEMENT)
    ;; Agent must be registered
    (asserts! (contract-call? .agent-registry is-registered agent) ERR-NOT-REGISTERED)

    ;; Check if this is a new endorsement (for counting)
    (let
      (
        (existing (map-get? endorsements { endorser: tx-sender, agent: agent }))
        (rep (default-to
          { total-score: u0, rating-count: u0, tasks-completed: u0, tasks-disputed: u0, endorsement-count: u0 }
          (map-get? agent-reputation { agent: agent })
        ))
      )
      ;; Record endorsement
      (map-set endorsements
        { endorser: tx-sender, agent: agent }
        { capability: capability, block: stacks-block-height }
      )

      ;; Increment endorsement count only if new
      (if (is-none existing)
        (map-set agent-reputation { agent: agent } (merge rep {
          endorsement-count: (+ (get endorsement-count rep) u1)
        }))
        true
      )
    )

    (print { event: "agent-endorsed", endorser: tx-sender, agent: agent, capability: capability })
    (ok true)
  )
)

;; Revoke an endorsement
(define-public (revoke-endorsement (agent principal))
  (let
    (
      (existing (map-get? endorsements { endorser: tx-sender, agent: agent }))
      (rep (default-to
        { total-score: u0, rating-count: u0, tasks-completed: u0, tasks-disputed: u0, endorsement-count: u0 }
        (map-get? agent-reputation { agent: agent })
      ))
    )
    ;; Delete the endorsement
    (map-delete endorsements { endorser: tx-sender, agent: agent })

    ;; Decrement count if it existed
    (if (is-some existing)
      (map-set agent-reputation { agent: agent } (merge rep {
        endorsement-count: (if (> (get endorsement-count rep) u0)
                             (- (get endorsement-count rep) u1)
                             u0)
      }))
      true
    )

    (print { event: "endorsement-revoked", endorser: tx-sender, agent: agent })
    (ok true)
  )
)

;; Record task completion (called by task-board contract only)
(define-public (record-completion
    (task-id uint)
    (agent principal)
    (poster principal)
  )
  (begin
    (asserts! (is-eq contract-caller (var-get task-board-contract)) ERR-NOT-AUTHORIZED)

    ;; Store completion record for rate-agent validation
    (map-set task-completions
      { task-id: task-id }
      { agent: agent, poster: poster }
    )

    (let
      (
        (rep (default-to
          { total-score: u0, rating-count: u0, tasks-completed: u0, tasks-disputed: u0, endorsement-count: u0 }
          (map-get? agent-reputation { agent: agent })
        ))
      )
      (map-set agent-reputation { agent: agent } (merge rep {
        tasks-completed: (+ (get tasks-completed rep) u1)
      }))
    )

    (print { event: "task-completed-recorded", task-id: task-id, agent: agent })
    (ok true)
  )
)

;; Record dispute (called by task-board contract only)
(define-public (record-dispute (agent principal))
  (begin
    (asserts! (is-eq contract-caller (var-get task-board-contract)) ERR-NOT-AUTHORIZED)

    (let
      (
        (rep (default-to
          { total-score: u0, rating-count: u0, tasks-completed: u0, tasks-disputed: u0, endorsement-count: u0 }
          (map-get? agent-reputation { agent: agent })
        ))
      )
      (map-set agent-reputation { agent: agent } (merge rep {
        tasks-disputed: (+ (get tasks-disputed rep) u1)
      }))
    )

    (print { event: "dispute-recorded", agent: agent })
    (ok true)
  )
)

;; ============================================================================
;; ADMIN FUNCTIONS
;; ============================================================================

;; Set the authorized task-board contract
(define-public (set-task-board (contract principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-AUTHORIZED)
    (var-set task-board-contract contract)
    (print { event: "task-board-set", contract: contract })
    (ok contract)
  )
)

;; Two-step admin transfer
(define-public (transfer-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-AUTHORIZED)
    (var-set pending-admin (some new-admin))
    (print { event: "admin-transfer-initiated", new-admin: new-admin })
    (ok new-admin)
  )
)

(define-public (accept-admin)
  (let
    (
      (pending (unwrap! (var-get pending-admin) ERR-NOT-AUTHORIZED))
    )
    (asserts! (is-eq tx-sender pending) ERR-NOT-AUTHORIZED)
    (var-set admin pending)
    (var-set pending-admin none)
    (print { event: "admin-transferred", admin: pending })
    (ok pending)
  )
)

;; ============================================================================
;; READ-ONLY FUNCTIONS
;; ============================================================================

(define-read-only (get-reputation (agent principal))
  (map-get? agent-reputation { agent: agent })
)

(define-read-only (get-rating (task-id uint) (rater principal))
  (map-get? ratings { task-id: task-id, rater: rater })
)

(define-read-only (get-endorsement (endorser principal) (agent principal))
  (map-get? endorsements { endorser: endorser, agent: agent })
)

(define-read-only (get-average-score (agent principal))
  (match (map-get? agent-reputation { agent: agent })
    rep (if (> (get rating-count rep) u0)
          (some (/ (get total-score rep) (get rating-count rep)))
          none
        )
    none
  )
)

(define-read-only (get-task-completion (task-id uint))
  (map-get? task-completions { task-id: task-id })
)

(define-read-only (get-task-board-contract)
  (var-get task-board-contract)
)

(define-read-only (get-admin)
  (var-get admin)
)
