/* ============================================================
   A-PLAY DASHBOARD — payment-wallet.js
   Owns everything related to orders and payment, separate from
   app.js so the payment surface can grow (real Apple Pay / Google
   Pay / Square integration, receipts, refunds) without touching
   the auth and routing logic in app.js.

   CURRENT SCOPE
   The only fully working payment path today is "Pay with Cash at
   Front Desk" — it writes a real order document to Firestore that
   staff can reconcile against the cash drawer. Apple Pay, Google
   Pay, and Square are intentionally left as clearly-labeled stubs:
   this project does not simulate a fake successful charge for any
   of them, because a fake "Payment Successful" screen would be
   actively misleading to a guest or a front-desk staff member.
   Wire up the real SDKs in the marked TODOs when those merchant
   accounts exist.

   This module has no DOM dependencies of its own. index.html does
   not yet include a storefront/checkout view, so there is nothing
   to attach click handlers to here — that view will call the
   exported functions below once it's built. In the meantime,
   app.js imports initPaymentWallet() so the Firebase references
   are ready the moment that UI lands.
============================================================ */

import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================
   MODULE STATE
   Populated once by initPaymentWallet(), called from app.js right
   after Firebase is initialized. Keeping these as module-level
   variables (rather than passing db/auth into every function call)
   keeps the exported API below focused on order data, not plumbing.
============================================================ */
let _db = null;
let _auth = null;
let _showToast = (message) => console.log("[payment-wallet]", message);

/**
 * initPaymentWallet
 * Called once from app.js after Firebase is initialized.
 * @param {{ db: import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js").Firestore,
 *           auth: import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js").Auth,
 *           showToast: (message: string) => void }} context
 */
export function initPaymentWallet(context){
  _db = context.db;
  _auth = context.auth;
  if(typeof context.showToast === "function"){
    _showToast = context.showToast;
  }
}

/* ============================================================
   ORDER MATH
   Pure function — no Firebase, no DOM — so it's easy to unit test
   once a test runner is added to this project.
============================================================ */
/**
 * calculateOrderTotal
 * @param {Array<{ price: number, qty: number }>} items
 * @returns {{ subtotal: number, total: number }}
 * There is no tax or discount logic yet (none has been specified
 * for this project); subtotal and total are equal today, but kept
 * as separate fields so a future discount/tax step doesn't require
 * a data-model change.
 */
export function calculateOrderTotal(items){
  const subtotal = (items || []).reduce((sum, item) => {
    const price = Number(item.price) || 0;
    const qty = Number(item.qty) || 0;
    return sum + (price * qty);
  }, 0);
  return { subtotal, total: subtotal };
}

/* ============================================================
   CASH AT FRONT DESK — the one fully functional payment path
============================================================ */
/**
 * recordCashPayment
 * Writes an order document with paymentMethod "cash" and status
 * "pending_at_desk". Staff mark it "paid" at the register once the
 * cash is collected (that status transition belongs to the future
 * storefront/checkout UI, not this module).
 *
 * @param {{ uid: string, items: Array<{ id: string, name: string, price: number, qty: number }> }} orderInput
 * @returns {Promise<string>} the new order document's ID
 */
export async function recordCashPayment(orderInput){
  if(!_db){
    throw new Error("payment-wallet: initPaymentWallet() must run before recordCashPayment().");
  }
  if(!orderInput || !orderInput.uid || !Array.isArray(orderInput.items) || orderInput.items.length === 0){
    throw new Error("payment-wallet: recordCashPayment requires a uid and a non-empty items array.");
  }

  const { subtotal, total } = calculateOrderTotal(orderInput.items);

  const orderRef = await addDoc(collection(_db, "orders"), {
    uid: orderInput.uid,
    items: orderInput.items,
    subtotal,
    total,
    paymentMethod: "cash",
    status: "pending_at_desk",
    createdAt: serverTimestamp()
  });

  _showToast("Order confirmed — please settle payment in cash at the front desk");
  return orderRef.id;
}

/* ============================================================
   FUTURE PAYMENT INTEGRATIONS (STUBS)
   Each function below returns a rejected Promise with a clear
   "not yet implemented" error rather than pretending to succeed.
   This keeps the UI honest: any screen that calls these today
   should catch the rejection and show the guest a real message
   ("Card payments aren't available yet — please pay cash at the
   front desk") instead of a fabricated success state.
============================================================ */

/**
 * initApplePaySession
 * TODO (future payment integration): implement using the Apple Pay
 * JS API (ApplePaySession) once A-Play has a merchant identifier
 * and a payment processor (e.g. Stripe or Square) configured to
 * validate the merchant session server-side. That server-side
 * validation step requires Firebase Cloud Functions, which are
 * listed as "later" infrastructure for this project.
 * @param {{ uid: string, items: Array }} orderInput
 * @returns {Promise<never>}
 */
export function initApplePaySession(orderInput){
  return Promise.reject(new Error("Apple Pay is not yet configured for A-Play. Use Pay with Cash at Front Desk for now."));
}

/**
 * initGooglePaySession
 * TODO (future payment integration): implement using the Google Pay
 * JS API (PaymentsClient.loadPaymentData) once a Google Pay merchant
 * ID and a supported payment gateway are configured.
 * @param {{ uid: string, items: Array }} orderInput
 * @returns {Promise<never>}
 */
export function initGooglePaySession(orderInput){
  return Promise.reject(new Error("Google Pay is not yet configured for A-Play. Use Pay with Cash at Front Desk for now."));
}

/**
 * initSquareCheckout
 * TODO (future payment integration): implement using the Square Web
 * Payments SDK once A-Play has a Square application ID and location
 * ID. Square access tokens must never be embedded in this file —
 * card processing has to go through a Cloud Function or other
 * server-side endpoint that holds the token, per the project's
 * "no sensitive credentials in client code" requirement.
 * @param {{ uid: string, items: Array }} orderInput
 * @returns {Promise<never>}
 */
export function initSquareCheckout(orderInput){
  return Promise.reject(new Error("Card payments via Square are not yet configured for A-Play. Use Pay with Cash at Front Desk for now."));
}
