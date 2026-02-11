;; title: agent-vault
;; version: 1.0.0
;; summary: Spending-controlled STX vaults for AI agents on Stacks
;; description: Agents deposit STX and set per-transaction caps, daily limits,
;;              and whitelists. Authorized callers can draw from vaults within
;;              policy bounds. All STX held by the contract; balances tracked in maps.
;;              Uses Clarity 4 as-contract? with explicit asset allowances.

;; ============================================================================
;; CONSTANTS
;; ============================================================================

(define-constant ERR-NO-VAULT (err u1100))
(define-constant ERR-VAULT-EXISTS (err u1101))
(define-constant ERR-UNAUTHORIZED (err u1102))
(define-constant ERR-EXCEEDED-TX-CAP (err u1103))
(define-constant ERR-EXCEEDED-DAILY-CAP (err u1104))
(define-constant ERR-INSUFFICIENT-FUNDS (err u1105))
(define-constant ERR-NOT-WHITELISTED (err u1106))
(define-constant ERR-ZERO-AMOUNT (err u1107))
(define-constant ERR-AGENT-NOT-REGISTERED (err u1108))
(define-constant ERR-CONTRACT-CALL (err u1109))

(define-constant BLOCKS-PER-DAY u144)

;; ============================================================================
;; STATE
;; ============================================================================

(define-data-var admin principal tx-sender)
(define-data-var pending-admin (optional principal) none)

;; ============================================================================
;; MAPS
;; ============================================================================

;; Vault state per agent
(define-map vaults
  { owner: principal }
  {
    balance: uint,
    per-tx-cap: uint,
    daily-cap: uint,
    daily-spent: uint,
    last-reset-block: uint,
    whitelist-only: bool,
    created-at: uint
  }
)

;; Whitelist: which principals can spend from a vault
(define-map whitelist
  { owner: principal, target: principal }
  { active: bool }
)

;; Sequential spend log per vault
(define-map spend-log
  { owner: principal, seq: uint }
  {
    spender: principal,
    amount: uint,
    block: uint,
    memo: (string-utf8 64)
  }
)

;; Next sequence number per vault
(define-map vault-seq
  { owner: principal }
  { next-seq: uint }
)

;; ============================================================================
;; PUBLIC FUNCTIONS
;; ============================================================================

;; Create a vault with spending policy
(define-public (create-vault
    (per-tx-cap uint)
    (daily-cap uint)
    (whitelist-only bool)
  )
  (begin
    ;; Check agent is registered in agent-registry
    (asserts! (contract-call? .agent-registry is-registered tx-sender) ERR-AGENT-NOT-REGISTERED)
    (asserts! (is-none (map-get? vaults { owner: tx-sender })) ERR-VAULT-EXISTS)

    (map-set vaults { owner: tx-sender } {
      balance: u0,
      per-tx-cap: per-tx-cap,
      daily-cap: daily-cap,
      daily-spent: u0,
      last-reset-block: stacks-block-height,
      whitelist-only: whitelist-only,
      created-at: stacks-block-height
    })

    (map-set vault-seq { owner: tx-sender } { next-seq: u0 })

    (print {
      event: "vault-created",
      owner: tx-sender,
      per-tx-cap: per-tx-cap,
      daily-cap: daily-cap,
      whitelist-only: whitelist-only
    })

    (ok true)
  )
)

;; Deposit STX into vault
(define-public (deposit (amount uint))
  (let
    (
      (vault (unwrap! (map-get? vaults { owner: tx-sender }) ERR-NO-VAULT))
      (caller tx-sender)
      ;; Get contract's own principal using as-contract? with no asset allowances
      (self (unwrap! (as-contract? () tx-sender) ERR-CONTRACT-CALL))
    )
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)

    ;; Transfer STX from depositor to this contract
    (try! (stx-transfer? amount caller self))

    ;; Update balance
    (map-set vaults { owner: caller } (merge vault {
      balance: (+ (get balance vault) amount)
    }))

    (print { event: "vault-deposit", owner: caller, amount: amount })
    (ok amount)
  )
)

;; Withdraw STX from vault (owner only)
(define-public (withdraw (amount uint))
  (let
    (
      (vault (unwrap! (map-get? vaults { owner: tx-sender }) ERR-NO-VAULT))
      (caller tx-sender)
    )
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (asserts! (<= amount (get balance vault)) ERR-INSUFFICIENT-FUNDS)

    ;; Transfer STX from contract to caller (with-stx declares max outflow)
    (unwrap! (as-contract? ((with-stx amount))
      (try! (stx-transfer? amount tx-sender caller))
    ) ERR-CONTRACT-CALL)

    ;; Update balance
    (map-set vaults { owner: caller } (merge vault {
      balance: (- (get balance vault) amount)
    }))

    (print { event: "vault-withdraw", owner: caller, amount: amount })
    (ok amount)
  )
)

;; Update vault spending policy
(define-public (update-policy
    (per-tx-cap uint)
    (daily-cap uint)
    (whitelist-only bool)
  )
  (let
    (
      (vault (unwrap! (map-get? vaults { owner: tx-sender }) ERR-NO-VAULT))
    )
    (map-set vaults { owner: tx-sender } (merge vault {
      per-tx-cap: per-tx-cap,
      daily-cap: daily-cap,
      whitelist-only: whitelist-only
    }))

    (print { event: "policy-updated", owner: tx-sender, per-tx-cap: per-tx-cap, daily-cap: daily-cap })
    (ok true)
  )
)

;; Add a principal to the whitelist
(define-public (add-to-whitelist (target principal))
  (begin
    (asserts! (is-some (map-get? vaults { owner: tx-sender })) ERR-NO-VAULT)

    (map-set whitelist
      { owner: tx-sender, target: target }
      { active: true }
    )

    (print { event: "whitelist-added", owner: tx-sender, target: target })
    (ok true)
  )
)

;; Remove a principal from the whitelist
(define-public (remove-from-whitelist (target principal))
  (begin
    (asserts! (is-some (map-get? vaults { owner: tx-sender })) ERR-NO-VAULT)

    (map-set whitelist
      { owner: tx-sender, target: target }
      { active: false }
    )

    (print { event: "whitelist-removed", owner: tx-sender, target: target })
    (ok true)
  )
)

;; Spend from an agent's vault (called by authorized contracts/principals)
(define-public (spend
    (owner principal)
    (amount uint)
    (memo (string-utf8 64))
  )
  (let
    (
      (vault (unwrap! (map-get? vaults { owner: owner }) ERR-NO-VAULT))
      (spender tx-sender)
      (current-daily (get-reset-daily owner vault))
    )
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)

    ;; Whitelist check
    (asserts! (or (not (get whitelist-only vault))
                  (is-whitelisted owner spender))
              ERR-NOT-WHITELISTED)

    ;; Per-tx cap check
    (asserts! (<= amount (get per-tx-cap vault)) ERR-EXCEEDED-TX-CAP)

    ;; Daily cap check (after potential reset)
    (asserts! (<= (+ current-daily amount) (get daily-cap vault)) ERR-EXCEEDED-DAILY-CAP)

    ;; Balance check
    (asserts! (<= amount (get balance vault)) ERR-INSUFFICIENT-FUNDS)

    ;; Transfer STX from contract to spender
    (unwrap! (as-contract? ((with-stx amount))
      (try! (stx-transfer? amount tx-sender spender))
    ) ERR-CONTRACT-CALL)

    ;; Update vault
    (let
      (
        (should-reset (>= (- stacks-block-height (get last-reset-block vault)) BLOCKS-PER-DAY))
        (new-daily-spent (if should-reset amount (+ (get daily-spent vault) amount)))
        (new-reset-block (if should-reset stacks-block-height (get last-reset-block vault)))
        (seq-data (default-to { next-seq: u0 } (map-get? vault-seq { owner: owner })))
        (current-seq (get next-seq seq-data))
      )
      (map-set vaults { owner: owner } (merge vault {
        balance: (- (get balance vault) amount),
        daily-spent: new-daily-spent,
        last-reset-block: new-reset-block
      }))

      ;; Log the spend
      (map-set spend-log
        { owner: owner, seq: current-seq }
        { spender: spender, amount: amount, block: stacks-block-height, memo: memo }
      )
      (map-set vault-seq { owner: owner } { next-seq: (+ current-seq u1) })
    )

    (print { event: "vault-spend", owner: owner, spender: spender, amount: amount, memo: memo })
    (ok amount)
  )
)

;; ============================================================================
;; ADMIN FUNCTIONS
;; ============================================================================

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

(define-read-only (get-vault (owner principal))
  (map-get? vaults { owner: owner })
)

(define-read-only (is-whitelisted (owner principal) (target principal))
  (match (map-get? whitelist { owner: owner, target: target })
    w (get active w)
    false
  )
)

(define-read-only (get-available-daily (owner principal))
  (match (map-get? vaults { owner: owner })
    vault
      (let
        (
          (current-daily (get-reset-daily owner vault))
        )
        (if (>= (get daily-cap vault) current-daily)
          (some (- (get daily-cap vault) current-daily))
          (some u0)
        )
      )
    none
  )
)

(define-read-only (get-spend-log-entry (owner principal) (seq uint))
  (map-get? spend-log { owner: owner, seq: seq })
)

(define-read-only (get-admin)
  (var-get admin)
)

;; ============================================================================
;; PRIVATE FUNCTIONS
;; ============================================================================

;; Get the effective daily-spent value, accounting for daily reset
(define-private (get-reset-daily
    (owner principal)
    (vault {
      balance: uint,
      per-tx-cap: uint,
      daily-cap: uint,
      daily-spent: uint,
      last-reset-block: uint,
      whitelist-only: bool,
      created-at: uint
    })
  )
  (if (>= (- stacks-block-height (get last-reset-block vault)) BLOCKS-PER-DAY)
    u0
    (get daily-spent vault)
  )
)
