;; title: x402-curve-router
;; version: 1.0.0
;; summary: Routes x402 payments through agent bonding curves
;; description: Instead of paying agents directly, x402 payments buy tokens on
;;              the agent's bonding curve. Payer gets tokens, STX enters the
;;              curve reserve, agent earns 80% of accrued fees at graduation.
;;              Nonce-based receipts for server-side payment verification.

;; ============================================================================
;; CONSTANTS
;; ============================================================================

(define-constant ERR-NONCE-USED (err u1500))
(define-constant ERR-ZERO-AMOUNT (err u1501))
(define-constant ERR-CURVE-NOT-FOUND (err u1502))
(define-constant ERR-UNAUTHORIZED (err u1503))

;; ============================================================================
;; STATE
;; ============================================================================

(define-data-var admin principal tx-sender)
(define-data-var total-payments uint u0)
(define-data-var total-volume-stx uint u0)

;; ============================================================================
;; MAPS
;; ============================================================================

;; Nonce -> payment receipt (replay protection + verification)
(define-map receipts
  { nonce: (buff 16) }
  {
    payer: principal,
    curve-id: uint,
    stx-amount: uint,
    tokens-received: uint,
    fee: uint,
    block: uint
  }
)

;; ============================================================================
;; PUBLIC FUNCTIONS
;; ============================================================================

;; Pay for an agent's service by buying tokens on their bonding curve.
;; STX goes into the curve reserve. Payer receives tokens.
;; Agent earns from accrued fees (80% at graduation).
(define-public (pay-via-curve
    (curve-id uint)
    (stx-amount uint)
    (nonce (buff 16))
    (min-tokens-out uint)
  )
  (begin
    ;; Nonce must be unused
    (asserts! (is-none (map-get? receipts { nonce: nonce })) ERR-NONCE-USED)
    (asserts! (> stx-amount u0) ERR-ZERO-AMOUNT)

    ;; Buy tokens on the curve
    ;; tx-sender's STX goes to the curve, tokens credited to tx-sender
    (let
      (
        (result (try! (contract-call? .agent-launchpad buy curve-id stx-amount min-tokens-out)))
        (tokens-out (get tokens-out result))
        (trade-fee (get fee result))
      )

      ;; Record receipt for server-side verification
      (map-set receipts { nonce: nonce } {
        payer: tx-sender,
        curve-id: curve-id,
        stx-amount: stx-amount,
        tokens-received: tokens-out,
        fee: trade-fee,
        block: stacks-block-height
      })

      ;; Update stats
      (var-set total-payments (+ (var-get total-payments) u1))
      (var-set total-volume-stx (+ (var-get total-volume-stx) stx-amount))

      ;; Emit event for indexing
      (print {
        event: "x402-curve-payment",
        payer: tx-sender,
        curve-id: curve-id,
        stx-amount: stx-amount,
        tokens-received: tokens-out,
        fee: trade-fee,
        nonce: nonce
      })

      (ok {
        tokens-received: tokens-out,
        fee: trade-fee
      })
    )
  )
)

;; ============================================================================
;; ADMIN
;; ============================================================================

(define-data-var pending-admin (optional principal) none)

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

;; Verify a payment by nonce - returns receipt or none
(define-read-only (verify-payment (nonce (buff 16)))
  (map-get? receipts { nonce: nonce })
)

;; Check if a nonce is available (not yet used)
(define-read-only (is-nonce-available (nonce (buff 16)))
  (is-none (map-get? receipts { nonce: nonce }))
)

;; Get protocol stats
(define-read-only (get-stats)
  {
    total-payments: (var-get total-payments),
    total-volume-stx: (var-get total-volume-stx),
    admin: (var-get admin)
  }
)

(define-read-only (get-admin)
  (var-get admin)
)
