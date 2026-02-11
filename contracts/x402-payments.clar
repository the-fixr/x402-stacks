;; title: x402-payments
;; version: 1.0.0
;; summary: Verifiable micropayment receipts for x402 protocol on Stacks
;; description: Enables HTTP 402 micropayments using STX or SIP-010 tokens
;;              with nonce-based replay protection and optional protocol fees.
;;              First x402 implementation on Stacks.

;; ============================================================================
;; TRAITS
;; ============================================================================

;; Minimal SIP-010 trait (only transfer needed)
(define-trait sip010-ft
  (
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
  )
)

;; ============================================================================
;; CONSTANTS
;; ============================================================================

(define-constant ERR-NONCE-USED (err u100))
(define-constant ERR-ZERO-AMOUNT (err u101))
(define-constant ERR-UNAUTHORIZED (err u102))
(define-constant ERR-INVALID-FEE (err u103))
(define-constant ERR-SELF-PAYMENT (err u104))

(define-constant MAX-FEE-BPS u1000)           ;; 10% max protocol fee
(define-constant PAYMENT-LIFETIME u144)        ;; ~24 hours in blocks (~10 min/block)

;; ============================================================================
;; STATE
;; ============================================================================

(define-data-var admin principal tx-sender)
(define-data-var fee-bps uint u0)              ;; Protocol fee basis points (0 = free)
(define-data-var fee-recipient principal tx-sender)
(define-data-var total-payments uint u0)
(define-data-var total-volume-stx uint u0)

;; ============================================================================
;; MAPS
;; ============================================================================

;; Nonce -> payment receipt (replay protection + verification)
(define-map payments
  { nonce: (buff 16) }
  {
    payer: principal,
    recipient: principal,
    amount: uint,
    fee: uint,
    block: uint,
    is-stx: bool
  }
)

;; ============================================================================
;; PUBLIC FUNCTIONS
;; ============================================================================

;; Pay STX to a recipient with nonce for replay protection
;; Client sends exact amount (net + fee). Post-conditions on client enforce safety.
(define-public (pay-stx
    (recipient principal)
    (amount uint)
    (nonce (buff 16))
  )
  (let
    (
      (fee (calc-fee amount))
      (net-amount (- amount fee))
    )
    ;; Validations
    (asserts! (is-none (map-get? payments { nonce: nonce })) ERR-NONCE-USED)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (asserts! (not (is-eq tx-sender recipient)) ERR-SELF-PAYMENT)

    ;; Transfer net amount to recipient
    (try! (stx-transfer? net-amount tx-sender recipient))

    ;; Transfer fee to fee recipient (if any)
    (if (> fee u0)
      (try! (stx-transfer? fee tx-sender (var-get fee-recipient)))
      true
    )

    ;; Record payment
    (map-set payments { nonce: nonce } {
      payer: tx-sender,
      recipient: recipient,
      amount: amount,
      fee: fee,
      block: stacks-block-height,
      is-stx: true
    })

    ;; Update stats
    (var-set total-payments (+ (var-get total-payments) u1))
    (var-set total-volume-stx (+ (var-get total-volume-stx) amount))

    ;; Emit event for indexing
    (print {
      event: "x402-payment",
      type: "stx",
      payer: tx-sender,
      recipient: recipient,
      amount: amount,
      fee: fee,
      nonce: nonce
    })

    (ok {
      payer: tx-sender,
      recipient: recipient,
      amount: net-amount,
      fee: fee,
      nonce: nonce
    })
  )
)

;; Pay SIP-010 token (sBTC, etc.) to a recipient
(define-public (pay-sip010
    (token <sip010-ft>)
    (recipient principal)
    (amount uint)
    (nonce (buff 16))
  )
  (let
    (
      (fee (calc-fee amount))
      (net-amount (- amount fee))
    )
    ;; Validations
    (asserts! (is-none (map-get? payments { nonce: nonce })) ERR-NONCE-USED)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (asserts! (not (is-eq tx-sender recipient)) ERR-SELF-PAYMENT)

    ;; Transfer net amount to recipient
    (try! (contract-call? token transfer net-amount tx-sender recipient none))

    ;; Transfer fee to fee recipient (if any)
    (if (> fee u0)
      (try! (contract-call? token transfer fee tx-sender (var-get fee-recipient) none))
      true
    )

    ;; Record payment
    (map-set payments { nonce: nonce } {
      payer: tx-sender,
      recipient: recipient,
      amount: amount,
      fee: fee,
      block: stacks-block-height,
      is-stx: false
    })

    ;; Update stats
    (var-set total-payments (+ (var-get total-payments) u1))

    ;; Emit event for indexing
    (print {
      event: "x402-payment",
      type: "sip010",
      payer: tx-sender,
      recipient: recipient,
      amount: amount,
      fee: fee,
      nonce: nonce
    })

    (ok {
      payer: tx-sender,
      recipient: recipient,
      amount: net-amount,
      fee: fee,
      nonce: nonce
    })
  )
)

;; ============================================================================
;; ADMIN FUNCTIONS
;; ============================================================================

;; Set protocol fee (basis points, max 10%)
(define-public (set-fee (new-fee-bps uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (asserts! (<= new-fee-bps MAX-FEE-BPS) ERR-INVALID-FEE)
    (var-set fee-bps new-fee-bps)
    (print { event: "fee-updated", fee-bps: new-fee-bps })
    (ok new-fee-bps)
  )
)

;; Set fee recipient address
(define-public (set-fee-recipient (new-recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (var-set fee-recipient new-recipient)
    (print { event: "fee-recipient-updated", recipient: new-recipient })
    (ok new-recipient)
  )
)

;; Transfer admin role (two-step: new admin must call accept-admin)
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

;; Verify a payment by nonce -- returns payment receipt or none
(define-read-only (verify-payment (nonce (buff 16)))
  (map-get? payments { nonce: nonce })
)

;; Check if a nonce is available (not yet used)
(define-read-only (is-nonce-available (nonce (buff 16)))
  (is-none (map-get? payments { nonce: nonce }))
)

;; Check if a payment is still fresh (within PAYMENT-LIFETIME blocks)
(define-read-only (is-payment-fresh (nonce (buff 16)))
  (match (map-get? payments { nonce: nonce })
    payment (< (- stacks-block-height (get block payment)) PAYMENT-LIFETIME)
    false
  )
)

;; Get current protocol fee in basis points
(define-read-only (get-fee-bps)
  (var-get fee-bps)
)

;; Get fee recipient
(define-read-only (get-fee-recipient)
  (var-get fee-recipient)
)

;; Get admin
(define-read-only (get-admin)
  (var-get admin)
)

;; Get pending admin (for two-step transfer)
(define-read-only (get-pending-admin)
  (var-get pending-admin)
)

;; Get protocol stats
(define-read-only (get-stats)
  {
    total-payments: (var-get total-payments),
    total-volume-stx: (var-get total-volume-stx),
    fee-bps: (var-get fee-bps),
    fee-recipient: (var-get fee-recipient),
    admin: (var-get admin)
  }
)

;; ============================================================================
;; PRIVATE FUNCTIONS
;; ============================================================================

;; Calculate fee from gross amount
;; fee = amount * fee_bps / 10000
;; Rounds down (favors payer on dust amounts)
(define-private (calc-fee (amount uint))
  (/ (* amount (var-get fee-bps)) u10000)
)
