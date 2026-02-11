;; title: agent-launchpad
;; version: 1.0.0
;; summary: Bonding curve token factory for registered AI agents on Stacks
;; description: Registered agents launch tokens with virtual constant product AMM.
;;              Internal ledger (no SIP-010 during curve phase). 1% trade fee
;;              accrues until graduation ($5k STX target), then split 80/20
;;              creator/protocol. Uses Clarity 4 as-contract? for STX custody.

;; ============================================================================
;; CONSTANTS
;; ============================================================================

(define-constant ERR-NOT-REGISTERED (err u1400))
(define-constant ERR-ALREADY-LAUNCHED (err u1401))
(define-constant ERR-CURVE-NOT-FOUND (err u1402))
(define-constant ERR-GRADUATED (err u1403))
(define-constant ERR-ZERO-AMOUNT (err u1404))
(define-constant ERR-INSUFFICIENT-BALANCE (err u1405))
(define-constant ERR-SLIPPAGE (err u1406))
(define-constant ERR-NOT-ADMIN (err u1407))
(define-constant ERR-OVERFLOW (err u1408))
(define-constant ERR-SELF-TRANSFER (err u1409))
(define-constant ERR-CONTRACT-CALL (err u1410))
(define-constant ERR-INVALID-PARAMS (err u1411))
(define-constant ERR-NOT-GRADUATED (err u1412))
(define-constant ERR-SOLD-OUT (err u1413))
(define-constant ERR-INVALID-FEE (err u1414))

(define-constant MAX-NAME-LEN u32)
(define-constant MAX-SYMBOL-LEN u10)
(define-constant MAX-FEE-BPS u500)
(define-constant MAX-CREATOR-SHARE-BPS u10000)
(define-constant BPS-DENOM u10000)
(define-constant PRICE-SCALE u1000000000000) ;; 10^12 for price precision

;; ============================================================================
;; STATE
;; ============================================================================

(define-data-var total-curves uint u0)
(define-data-var admin principal tx-sender)
(define-data-var pending-admin (optional principal) none)
(define-data-var protocol-fee-recipient principal tx-sender)

;; Protocol defaults - snapshotted into each curve at launch time
(define-data-var default-total-supply uint u1000000000000000)     ;; 1B tokens (6 decimals)
(define-data-var default-virtual-stx uint u10000000000)           ;; 10,000 STX (microSTX)
(define-data-var default-graduation-stx uint u16667000000)        ;; ~16,667 STX (~$5k at ~$0.30)
(define-data-var default-fee-bps uint u100)                       ;; 1%
(define-data-var default-creator-share-bps uint u8000)            ;; 80%

;; ============================================================================
;; MAPS
;; ============================================================================

;; Curve record - snapshot of params at launch time
(define-map curves
  { id: uint }
  {
    creator: principal,
    name: (string-utf8 32),
    symbol: (string-utf8 10),
    total-supply: uint,
    virtual-stx: uint,
    k: uint,
    stx-reserve: uint,
    tokens-sold: uint,
    graduation-stx: uint,
    fee-bps: uint,
    accrued-fees: uint,
    graduated: bool,
    created-at: uint,
    creator-share-bps: uint
  }
)

;; Token balances (internal ledger)
(define-map balances
  { curve-id: uint, holder: principal }
  { amount: uint }
)

;; Agent to curve mapping (1 curve per agent)
(define-map agent-curve
  { agent: principal }
  { curve-id: uint }
)

;; ============================================================================
;; PUBLIC FUNCTIONS
;; ============================================================================

;; Launch a new bonding curve (registered agents only)
(define-public (launch
    (name (string-utf8 32))
    (symbol (string-utf8 10))
  )
  (let
    (
      (curve-id (var-get total-curves))
      (ts (var-get default-total-supply))
      (vs (var-get default-virtual-stx))
      (k (* vs ts))
    )
    ;; Must be registered agent
    (asserts! (contract-call? .agent-registry is-registered tx-sender) ERR-NOT-REGISTERED)
    ;; One curve per agent
    (asserts! (is-none (map-get? agent-curve { agent: tx-sender })) ERR-ALREADY-LAUNCHED)
    ;; Validate params
    (asserts! (> (len name) u0) ERR-INVALID-PARAMS)
    (asserts! (> (len symbol) u0) ERR-INVALID-PARAMS)
    (asserts! (> ts u0) ERR-INVALID-PARAMS)
    (asserts! (> vs u0) ERR-INVALID-PARAMS)

    ;; Create curve
    (map-set curves { id: curve-id } {
      creator: tx-sender,
      name: name,
      symbol: symbol,
      total-supply: ts,
      virtual-stx: vs,
      k: k,
      stx-reserve: u0,
      tokens-sold: u0,
      graduation-stx: (var-get default-graduation-stx),
      fee-bps: (var-get default-fee-bps),
      accrued-fees: u0,
      graduated: false,
      created-at: stacks-block-height,
      creator-share-bps: (var-get default-creator-share-bps)
    })

    ;; Map agent to curve
    (map-set agent-curve { agent: tx-sender } { curve-id: curve-id })

    (var-set total-curves (+ curve-id u1))

    (print {
      event: "curve-launched",
      curve-id: curve-id,
      creator: tx-sender,
      name: name,
      symbol: symbol,
      total-supply: ts,
      virtual-stx: vs,
      graduation-stx: (var-get default-graduation-stx)
    })

    (ok curve-id)
  )
)

;; Buy tokens with STX
(define-public (buy
    (curve-id uint)
    (stx-amount uint)
    (min-tokens-out uint)
  )
  (let
    (
      (curve (unwrap! (map-get? curves { id: curve-id }) ERR-CURVE-NOT-FOUND))
      (caller tx-sender)
      (self (unwrap! (as-contract? () tx-sender) ERR-CONTRACT-CALL))
      ;; Fee calculation
      (fee (/ (* stx-amount (get fee-bps curve)) BPS-DENOM))
      (net-stx (- stx-amount fee))
      ;; AMM math
      (token-reserve (- (get total-supply curve) (get tokens-sold curve)))
      (new-stx-reserve (+ (get stx-reserve curve) net-stx))
      (new-token-reserve (/ (get k curve) (+ (get virtual-stx curve) new-stx-reserve)))
      (tokens-out (- token-reserve new-token-reserve))
      ;; Buyer's existing balance
      (existing-bal (default-to { amount: u0 } (map-get? balances { curve-id: curve-id, holder: caller })))
      ;; Updated reserve after trade
      (updated-stx-reserve new-stx-reserve)
    )
    ;; Validations
    (asserts! (not (get graduated curve)) ERR-GRADUATED)
    (asserts! (> stx-amount u0) ERR-ZERO-AMOUNT)
    (asserts! (> token-reserve u0) ERR-SOLD-OUT)
    (asserts! (> tokens-out u0) ERR-OVERFLOW)
    (asserts! (>= tokens-out min-tokens-out) ERR-SLIPPAGE)

    ;; Transfer STX from buyer to contract
    (try! (stx-transfer? stx-amount caller self))

    ;; Update curve state
    (map-set curves { id: curve-id } (merge curve {
      stx-reserve: updated-stx-reserve,
      tokens-sold: (+ (get tokens-sold curve) tokens-out),
      accrued-fees: (+ (get accrued-fees curve) fee)
    }))

    ;; Update buyer balance
    (map-set balances
      { curve-id: curve-id, holder: caller }
      { amount: (+ (get amount existing-bal) tokens-out) }
    )

    ;; Check for auto-graduation
    (if (>= updated-stx-reserve (get graduation-stx curve))
      (try! (graduate-internal curve-id))
      true
    )

    (print {
      event: "token-bought",
      curve-id: curve-id,
      buyer: caller,
      stx-in: stx-amount,
      tokens-out: tokens-out,
      fee: fee,
      new-stx-reserve: updated-stx-reserve
    })

    (ok { tokens-out: tokens-out, fee: fee })
  )
)

;; Sell tokens for STX
(define-public (sell
    (curve-id uint)
    (token-amount uint)
    (min-stx-out uint)
  )
  (let
    (
      (curve (unwrap! (map-get? curves { id: curve-id }) ERR-CURVE-NOT-FOUND))
      (caller tx-sender)
      (seller-bal (unwrap! (map-get? balances { curve-id: curve-id, holder: caller }) ERR-INSUFFICIENT-BALANCE))
      ;; AMM math
      (token-reserve (- (get total-supply curve) (get tokens-sold curve)))
      (new-token-reserve (+ token-reserve token-amount))
      (new-stx-reserve (- (/ (get k curve) new-token-reserve) (get virtual-stx curve)))
      (gross-stx (- (get stx-reserve curve) new-stx-reserve))
      ;; Fee
      (fee (/ (* gross-stx (get fee-bps curve)) BPS-DENOM))
      (stx-out (- gross-stx fee))
    )
    ;; Validations
    (asserts! (not (get graduated curve)) ERR-GRADUATED)
    (asserts! (> token-amount u0) ERR-ZERO-AMOUNT)
    (asserts! (>= (get amount seller-bal) token-amount) ERR-INSUFFICIENT-BALANCE)
    (asserts! (> stx-out u0) ERR-OVERFLOW)
    (asserts! (>= stx-out min-stx-out) ERR-SLIPPAGE)

    ;; Transfer STX from contract to seller
    (unwrap! (as-contract? ((with-stx stx-out))
      (try! (stx-transfer? stx-out tx-sender caller))
    ) ERR-CONTRACT-CALL)

    ;; Update curve state
    (map-set curves { id: curve-id } (merge curve {
      stx-reserve: new-stx-reserve,
      tokens-sold: (- (get tokens-sold curve) token-amount),
      accrued-fees: (+ (get accrued-fees curve) fee)
    }))

    ;; Update seller balance
    (map-set balances
      { curve-id: curve-id, holder: caller }
      { amount: (- (get amount seller-bal) token-amount) }
    )

    (print {
      event: "token-sold",
      curve-id: curve-id,
      seller: caller,
      tokens-in: token-amount,
      stx-out: stx-out,
      fee: fee,
      new-stx-reserve: new-stx-reserve
    })

    (ok { stx-out: stx-out, fee: fee })
  )
)

;; Transfer tokens between holders
(define-public (transfer
    (curve-id uint)
    (amount uint)
    (recipient principal)
  )
  (let
    (
      (sender-bal (unwrap! (map-get? balances { curve-id: curve-id, holder: tx-sender }) ERR-INSUFFICIENT-BALANCE))
      (recipient-bal (default-to { amount: u0 } (map-get? balances { curve-id: curve-id, holder: recipient })))
    )
    ;; Curve must exist
    (asserts! (is-some (map-get? curves { id: curve-id })) ERR-CURVE-NOT-FOUND)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (asserts! (not (is-eq tx-sender recipient)) ERR-SELF-TRANSFER)
    (asserts! (>= (get amount sender-bal) amount) ERR-INSUFFICIENT-BALANCE)

    ;; Update balances
    (map-set balances
      { curve-id: curve-id, holder: tx-sender }
      { amount: (- (get amount sender-bal) amount) }
    )
    (map-set balances
      { curve-id: curve-id, holder: recipient }
      { amount: (+ (get amount recipient-bal) amount) }
    )

    (print {
      event: "token-transferred",
      curve-id: curve-id,
      from: tx-sender,
      to: recipient,
      amount: amount
    })

    (ok true)
  )
)

;; Manually trigger graduation (anyone can call if threshold met)
(define-public (graduate (curve-id uint))
  (begin
    (try! (graduate-internal curve-id))
    (ok true)
  )
)

;; ============================================================================
;; ADMIN FUNCTIONS
;; ============================================================================

;; Set protocol defaults for future launches
(define-public (set-defaults
    (new-total-supply uint)
    (new-virtual-stx uint)
    (new-graduation-stx uint)
    (new-fee-bps uint)
    (new-creator-share-bps uint)
  )
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (asserts! (> new-total-supply u0) ERR-INVALID-PARAMS)
    (asserts! (> new-virtual-stx u0) ERR-INVALID-PARAMS)
    (asserts! (> new-graduation-stx u0) ERR-INVALID-PARAMS)
    (asserts! (<= new-fee-bps MAX-FEE-BPS) ERR-INVALID-FEE)
    (asserts! (<= new-creator-share-bps MAX-CREATOR-SHARE-BPS) ERR-INVALID-PARAMS)

    (var-set default-total-supply new-total-supply)
    (var-set default-virtual-stx new-virtual-stx)
    (var-set default-graduation-stx new-graduation-stx)
    (var-set default-fee-bps new-fee-bps)
    (var-set default-creator-share-bps new-creator-share-bps)

    (print {
      event: "defaults-updated",
      total-supply: new-total-supply,
      virtual-stx: new-virtual-stx,
      graduation-stx: new-graduation-stx,
      fee-bps: new-fee-bps,
      creator-share-bps: new-creator-share-bps
    })

    (ok true)
  )
)

;; Set protocol fee recipient
(define-public (set-protocol-fee-recipient (new-recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (var-set protocol-fee-recipient new-recipient)
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
;; PRIVATE FUNCTIONS
;; ============================================================================

;; Internal graduation logic - splits accrued fees 80/20
(define-private (graduate-internal (curve-id uint))
  (let
    (
      (curve (unwrap! (map-get? curves { id: curve-id }) ERR-CURVE-NOT-FOUND))
      (fees (get accrued-fees curve))
      (creator-share (/ (* fees (get creator-share-bps curve)) BPS-DENOM))
      (protocol-share (- fees creator-share))
      (creator (get creator curve))
      (recipient (var-get protocol-fee-recipient))
    )
    ;; Must meet graduation threshold
    (asserts! (>= (get stx-reserve curve) (get graduation-stx curve)) ERR-NOT-GRADUATED)
    ;; Can't graduate twice
    (asserts! (not (get graduated curve)) ERR-GRADUATED)

    ;; Pay creator their fee share
    (if (> creator-share u0)
      (unwrap! (as-contract? ((with-stx creator-share))
        (try! (stx-transfer? creator-share tx-sender creator))
      ) ERR-CONTRACT-CALL)
      true
    )

    ;; Pay protocol their fee share
    (if (> protocol-share u0)
      (unwrap! (as-contract? ((with-stx protocol-share))
        (try! (stx-transfer? protocol-share tx-sender recipient))
      ) ERR-CONTRACT-CALL)
      true
    )

    ;; Mark graduated
    (map-set curves { id: curve-id } (merge curve {
      graduated: true,
      accrued-fees: u0
    }))

    (print {
      event: "curve-graduated",
      curve-id: curve-id,
      total-fees: fees,
      creator-share: creator-share,
      protocol-share: protocol-share
    })

    (ok true)
  )
)

;; ============================================================================
;; READ-ONLY FUNCTIONS
;; ============================================================================

(define-read-only (get-curve (id uint))
  (map-get? curves { id: id })
)

(define-read-only (get-balance (curve-id uint) (holder principal))
  (default-to { amount: u0 } (map-get? balances { curve-id: curve-id, holder: holder }))
)

(define-read-only (get-agent-curve (agent principal))
  (map-get? agent-curve { agent: agent })
)

;; Preview a buy: returns tokens-out and fee for a given STX input
(define-read-only (get-buy-quote (curve-id uint) (stx-amount uint))
  (let
    (
      (curve (unwrap! (map-get? curves { id: curve-id }) ERR-CURVE-NOT-FOUND))
      (fee (/ (* stx-amount (get fee-bps curve)) BPS-DENOM))
      (net-stx (- stx-amount fee))
      (token-reserve (- (get total-supply curve) (get tokens-sold curve)))
      (new-stx-reserve (+ (get stx-reserve curve) net-stx))
      (new-token-reserve (/ (get k curve) (+ (get virtual-stx curve) new-stx-reserve)))
      (tokens-out (- token-reserve new-token-reserve))
    )
    (ok { tokens-out: tokens-out, fee: fee })
  )
)

;; Preview a sell: returns STX-out and fee for a given token input
(define-read-only (get-sell-quote (curve-id uint) (token-amount uint))
  (let
    (
      (curve (unwrap! (map-get? curves { id: curve-id }) ERR-CURVE-NOT-FOUND))
      (token-reserve (- (get total-supply curve) (get tokens-sold curve)))
      (new-token-reserve (+ token-reserve token-amount))
      (new-stx-reserve (- (/ (get k curve) new-token-reserve) (get virtual-stx curve)))
      (gross-stx (- (get stx-reserve curve) new-stx-reserve))
      (fee (/ (* gross-stx (get fee-bps curve)) BPS-DENOM))
      (stx-out (- gross-stx fee))
    )
    (ok { stx-out: stx-out, fee: fee })
  )
)

;; Current marginal price scaled by PRICE-SCALE (10^12) for precision
;; To get actual microSTX per smallest token unit: divide result by PRICE-SCALE
(define-read-only (get-price (curve-id uint))
  (let
    (
      (curve (unwrap! (map-get? curves { id: curve-id }) ERR-CURVE-NOT-FOUND))
      (token-reserve (- (get total-supply curve) (get tokens-sold curve)))
    )
    (if (is-eq token-reserve u0)
      (ok u0)
      (ok (/ (* (+ (get virtual-stx curve) (get stx-reserve curve)) PRICE-SCALE) token-reserve))
    )
  )
)

(define-read-only (get-stats)
  {
    total-curves: (var-get total-curves),
    default-total-supply: (var-get default-total-supply),
    default-virtual-stx: (var-get default-virtual-stx),
    default-graduation-stx: (var-get default-graduation-stx),
    default-fee-bps: (var-get default-fee-bps),
    default-creator-share-bps: (var-get default-creator-share-bps)
  }
)

(define-read-only (get-admin)
  (var-get admin)
)

(define-read-only (get-protocol-fee-recipient)
  (var-get protocol-fee-recipient)
)
