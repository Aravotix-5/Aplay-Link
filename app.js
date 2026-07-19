/* ============================================================
   A-PLAY DASHBOARD — app.js
   Single entry point (loaded as <script type="module"> from
   index.html). Responsibilities:
     1. Initialize Firebase (App, Auth, Firestore).
     2. Drive the login / register forms.
     3. Listen for auth state changes and route to the correct
        role-based dashboard (owner / staff / parent / guest).
     4. Render each dashboard's live Firestore data.
     5. Wire up the bottom tab bar and shared toast / modal.
     6. Hand off to payment-wallet.js for anything payment-related.

   FIRESTORE DATA MODEL (documented here since there is no backend
   README in this project yet):
     users/{uid}
       - fullName:   string
       - phone:      string
       - email:      string
       - role:       "owner" | "staff" | "parent" | "guest"
       - childProfile?: { fullName, age, weight, pass: { name, price } }
       - passTier?:  { name, price }          (guest role only)
       - createdAt:  server timestamp
     inventory/{id}
       - name, price, unit, quantity, createdAt
     checkins/{id}
       - guestId, guestName, status: "active" | "checked-out"
       - checkedInAt, checkedOutAt
     staffInvites/{id}
       - email, role: "staff", status: "pending", invitedAt
     orders/{id}   (written by payment-wallet.js)
       - uid, items[], subtotal, total, paymentMethod, status, createdAt
============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { initPaymentWallet } from "./payment-wallet.js";

/* ============================================================
   FIREBASE CONFIGURATION
   These values (apiKey, authDomain, projectId, storageBucket,
   messagingSenderId, appId, measurementId) are safe to ship in
   client-side code by design — Firebase's own docs are explicit
   about this. They only identify which Firebase project a request
   belongs to; they grant no access on their own. Actual access
   control lives in Firestore Security Rules and in the "Authorized
   domains" list under Firebase Console > Authentication > Settings.

   Intentionally absent from this file, by design: OAuth client
   secrets, Firebase Admin private keys, and any user passwords —
   none of those belong in client-side code, and none of them are
   needed for the email/password or Google sign-in flows below.
============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyAFx-B8NTTLykCljJ-KURf2U4D0v-XpXQY",
  authDomain: "aplay-dashboard.firebaseapp.com",
  projectId: "aplay-dashboard",
  storageBucket: "aplay-dashboard.firebasestorage.app",
  messagingSenderId: "199024646802",
  appId: "1:199024646802:web:962b434c4be9e8985c644b",
  measurementId: "G-SBHJSJDP3F"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const googleProvider = new GoogleAuthProvider();

/* This Google Cloud OAuth Web Client ID is NOT passed into
   GoogleAuthProvider — signInWithPopup() below uses the OAuth
   client that Firebase automatically provisions once "Google" is
   enabled as a sign-in provider in the Firebase Console, and that's
   all a client-side popup flow needs. This constant is kept here,
   unused for now, for the day this project adds Google One Tap or
   a Cloud Function that verifies Google ID tokens server-side —
   both of those DO need the raw client ID on hand. */
const GOOGLE_CLIENT_ID = "249842806211-59ffnpuva8m5sh5nb4epfrhrqrgc83vd.apps.googleusercontent.com";

/* ============================================================
   DOM REFERENCES
   Grabbed once at module load. All IDs match index.html exactly.
============================================================ */
const loadingOverlay = document.getElementById("loadingOverlay");
const appShell = document.getElementById("app");

const topBar = document.getElementById("topBar");
const userChip = document.getElementById("userChip");
const userChipName = document.getElementById("userChipName");
const userChipRole = document.getElementById("userChipRole");
const signOutBtn = document.getElementById("signOutBtn");

const authModeToggle = document.getElementById("authModeToggle");
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginFormError = document.getElementById("loginFormError");
const loginSubmitBtn = document.getElementById("loginSubmitBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const googleSignInBtn = document.getElementById("googleSignInBtn");

const registerForm = document.getElementById("registerForm");
const registerFullName = document.getElementById("registerFullName");
const registerPhone = document.getElementById("registerPhone");
const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");
const registerFormError = document.getElementById("registerFormError");
const registerSubmitBtn = document.getElementById("registerSubmitBtn");

const toastEl = document.getElementById("toast");

const confirmModal = document.getElementById("confirmModal");
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalBody = document.getElementById("confirmModalBody");
const confirmModalCancelBtn = document.getElementById("confirmModalCancelBtn");
const confirmModalConfirmBtn = document.getElementById("confirmModalConfirmBtn");

const views = Array.from(document.querySelectorAll(".view"));
const tabBars = Array.from(document.querySelectorAll(".tab-bar"));

// Owner dashboard elements
const ownerStatGuests = document.getElementById("ownerStatGuests");
const ownerStatStaff = document.getElementById("ownerStatStaff");
const ownerStatRevenue = document.getElementById("ownerStatRevenue");
const ownerStatInventory = document.getElementById("ownerStatInventory");
const ownerStaffList = document.getElementById("ownerStaffList");
const ownerInviteStaffBtn = document.getElementById("ownerInviteStaffBtn");
const ownerInventoryList = document.getElementById("ownerInventoryList");
const ownerAddInventoryBtn = document.getElementById("ownerAddInventoryBtn");

// Staff dashboard elements
const staffScanInput = document.getElementById("staffScanInput");
const staffCheckInBtn = document.getElementById("staffCheckInBtn");
const staffCheckOutBtn = document.getElementById("staffCheckOutBtn");
const staffActiveGuestList = document.getElementById("staffActiveGuestList");
const staffInventoryList = document.getElementById("staffInventoryList");

// Parent dashboard elements
const parentPassChildName = document.getElementById("parentPassChildName");
const parentPassTier = document.getElementById("parentPassTier");
const parentChildName = document.getElementById("parentChildName");
const parentChildAge = document.getElementById("parentChildAge");
const parentChildWeight = document.getElementById("parentChildWeight");
const parentVisitHistory = document.getElementById("parentVisitHistory");

// Guest dashboard elements
const guestPassName = document.getElementById("guestPassName");
const guestPassTier = document.getElementById("guestPassTier");
const guestZoneInfo = document.getElementById("guestZoneInfo");

/* ============================================================
   SHARED HELPERS: TOAST
   Exported so payment-wallet.js (and any future module) can
   surface feedback through the same UI element.
============================================================ */
let toastTimer = null;
export function showToast(message){
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

/* ============================================================
   SHARED HELPERS: CONFIRMATION MODAL
   showConfirm(title, body) returns a Promise<boolean> so callers
   can `await` the user's decision instead of juggling callbacks.
============================================================ */
function showConfirm(title, body){
  confirmModalTitle.textContent = title;
  confirmModalBody.textContent = body;
  confirmModal.classList.remove("hidden");

  return new Promise((resolve) => {
    function cleanup(result){
      confirmModal.classList.add("hidden");
      confirmModalConfirmBtn.removeEventListener("click", onConfirm);
      confirmModalCancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onConfirm(){ cleanup(true); }
    function onCancel(){ cleanup(false); }
    confirmModalConfirmBtn.addEventListener("click", onConfirm);
    confirmModalCancelBtn.addEventListener("click", onCancel);
  });
}

/* ============================================================
   VIEW / TAB ROUTING
============================================================ */
function showView(viewId){
  views.forEach(v => v.classList.toggle("active", v.id === viewId));
}

function showTabBarForRole(role){
  tabBars.forEach(bar => bar.classList.toggle("hidden", bar.dataset.role !== role));
}

/* Wire every tab button once, at module load. A button either
   targets a real top-level view ("view-owner", "view-staff", ...)
   or a named sub-section that does not have its own view yet
   (e.g. "owner-inventory"). For the latter we gracefully no-op
   with a toast rather than guessing at markup that does not
   exist in index.html. */
tabBars.forEach(bar => {
  const buttons = Array.from(bar.querySelectorAll(".tab-btn"));
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.toggle("active", b === btn));
      const target = btn.dataset.target;
      if(target && target.startsWith("view-")){
        showView(target);
      }else{
        // Sub-section navigation (staff list, inventory, storefront, etc.)
        // is scoped to the current dashboard view; scroll to it if a
        // matching element exists, otherwise let the user know it's
        // not wired up to a dedicated screen yet.
        const anchor = document.getElementById(target);
        if(anchor){
          anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        }else{
          showToast("That section isn't available yet");
        }
      }
    });
  });
});

/* ============================================================
   AUTH MODE TOGGLE (Sign In / Create Account)
============================================================ */
authModeToggle.querySelectorAll(".segmented-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    authModeToggle.querySelectorAll(".segmented-btn").forEach(b => {
      const isActive = b === btn;
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-selected", String(isActive));
    });
    loginForm.classList.toggle("hidden", mode !== "login");
    registerForm.classList.toggle("hidden", mode !== "register");
    loginFormError.textContent = "";
    registerFormError.textContent = "";
  });
});

/* ============================================================
   SIGN IN
============================================================ */
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginFormError.textContent = "";
  loginSubmitBtn.disabled = true;
  loginSubmitBtn.textContent = "Signing In…";

  try{
    await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value);
    // onAuthStateChanged below takes it from here.
  }catch(err){
    console.error("A-Play: sign-in failed.", err);
    loginFormError.textContent = friendlyAuthError(err);
  }finally{
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.textContent = "Sign In";
  }
});

forgotPasswordBtn.addEventListener("click", async () => {
  const email = loginEmail.value.trim();
  if(!email){
    loginFormError.textContent = "Enter your email above first, then tap Forgot password.";
    return;
  }
  try{
    await sendPasswordResetEmail(auth, email);
    showToast("Password reset email sent");
  }catch(err){
    console.error("A-Play: password reset failed.", err);
    loginFormError.textContent = friendlyAuthError(err);
  }
});

/* ============================================================
   GOOGLE OAUTH SIGN-IN
   Same downstream handling as email/password: onAuthStateChanged
   picks up the resulting session and routes by role. The only
   Google-specific work here is provisioning a Firestore user
   document the very first time a given Google account signs in —
   existing Google users just fall straight through to their
   existing profile.
============================================================ */
googleSignInBtn.addEventListener("click", async () => {
  googleSignInBtn.disabled = true;
  loginFormError.textContent = "";
  try{
    const result = await signInWithPopup(auth, googleProvider);
    const userRef = doc(db, "users", result.user.uid);
    const existingSnap = await getDoc(userRef);

    if(!existingSnap.exists()){
      // First time this Google account has signed in — provision a
      // "parent" profile, same default role as self-service email
      // registration. Google doesn't provide a phone number, so that
      // field starts blank; front-desk staff can fill it in later,
      // since there's no "complete your profile" screen yet.
      await setDoc(userRef, {
        fullName: result.user.displayName || result.user.email,
        phone: "",
        email: result.user.email,
        role: "parent",
        createdAt: serverTimestamp()
      });
    }
    // onAuthStateChanged below takes it from here.
  }catch(err){
    // A user closing the Google popup counts as "auth/popup-closed-by-user"
    // — that's a normal cancellation, not an error worth alarming anyone with.
    if(err && err.code === "auth/popup-closed-by-user"){
      return;
    }
    console.error("A-Play: Google sign-in failed.", err);
    loginFormError.textContent = friendlyAuthError(err);
  }finally{
    googleSignInBtn.disabled = false;
  }
});

/* ============================================================
   REGISTER (always creates a "parent" role account —
   Owner and Staff accounts are provisioned directly in Firestore
   by resort administration, per the auth-view footnote in index.html)
============================================================ */
registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  registerFormError.textContent = "";
  registerSubmitBtn.disabled = true;
  registerSubmitBtn.textContent = "Creating Account…";

  try{
    const credential = await createUserWithEmailAndPassword(
      auth,
      registerEmail.value.trim(),
      registerPassword.value
    );

    await setDoc(doc(db, "users", credential.user.uid), {
      fullName: registerFullName.value.trim(),
      phone: registerPhone.value.trim(),
      email: registerEmail.value.trim(),
      role: "parent",
      createdAt: serverTimestamp()
    });

    // onAuthStateChanged below takes it from here.
  }catch(err){
    console.error("A-Play: registration failed.", err);
    registerFormError.textContent = friendlyAuthError(err);
  }finally{
    registerSubmitBtn.disabled = false;
    registerSubmitBtn.textContent = "Create Account";
  }
});

function friendlyAuthError(err){
  const code = err && err.code ? err.code : "";
  switch(code){
    case "auth/invalid-email": return "That email address doesn't look right.";
    case "auth/user-not-found": return "No account found for that email.";
    case "auth/wrong-password": return "Incorrect password.";
    case "auth/email-already-in-use": return "An account already exists for that email.";
    case "auth/weak-password": return "Choose a password with at least 8 characters.";
    case "auth/popup-blocked": return "Your browser blocked the Google sign-in popup — please allow popups and try again.";
    case "auth/account-exists-with-different-credential": return "That email is already linked to a different sign-in method. Try email and password instead.";
    default: return "Something went wrong. Please try again.";
  }
}

/* ============================================================
   SIGN OUT (behind the shared confirmation modal)
============================================================ */
signOutBtn.addEventListener("click", async () => {
  const confirmed = await showConfirm("Sign out?", "You'll need to sign in again to access your dashboard.");
  if(!confirmed) return;
  try{
    await signOut(auth);
  }catch(err){
    console.error("A-Play: sign-out failed.", err);
    showToast("Could not sign out — please try again");
  }
});

/* ============================================================
   AUTH STATE LISTENER — the real "router" of the app
============================================================ */
const activeUnsubscribers = []; // Firestore onSnapshot listeners for the current session

function clearActiveListeners(){
  while(activeUnsubscribers.length){
    const unsubscribe = activeUnsubscribers.pop();
    try{ unsubscribe(); }catch(err){ /* listener already gone — safe to ignore */ }
  }
}

onAuthStateChanged(auth, async (user) => {
  clearActiveListeners();

  if(!user){
    userChip.classList.add("hidden");
    showView("view-auth");
    tabBars.forEach(bar => bar.classList.add("hidden"));
    revealApp();
    return;
  }

  try{
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if(!userSnap.exists()){
      console.error("A-Play: signed-in user has no Firestore profile document.");
      showToast("Your account is missing a profile — contact the front desk");
      await signOut(auth);
      return;
    }

    const profile = userSnap.data();
    userChipName.textContent = profile.fullName || user.email;
    userChipRole.textContent = profile.role || "guest";
    userChip.classList.remove("hidden");

    routeToRole(user.uid, profile);
  }catch(err){
    console.error("A-Play: failed to load user profile.", err);
    showToast("Could not load your profile — please try again");
  }finally{
    revealApp();
  }
});

function revealApp(){
  loadingOverlay.classList.add("hidden");
  appShell.classList.remove("hidden");
}

function routeToRole(uid, profile){
  const role = profile.role;
  showTabBarForRole(role);

  switch(role){
    case "owner":
      showView("view-owner");
      startOwnerListeners();
      break;
    case "staff":
      showView("view-staff");
      startStaffListeners();
      break;
    case "parent":
      showView("view-parent");
      renderParentDashboard(profile);
      startParentHistoryListener(uid);
      break;
    case "guest":
    default:
      showView("view-guest");
      renderGuestDashboard(profile);
      break;
  }
}

/* ============================================================
   OWNER CONTROL CENTER
============================================================ */
function startOwnerListeners(){
  // Staff roster
  const staffQuery = query(collection(db, "users"), where("role", "==", "staff"));
  const unsubStaff = onSnapshot(staffQuery, (snapshot) => {
    ownerStatStaff.textContent = String(snapshot.size);
    renderRosterList(ownerStaffList, snapshot.docs.map(d => ({
      name: d.data().fullName || d.data().email,
      meta: d.data().email,
      active: true
    })));
  }, (err) => console.error("A-Play: staff roster listener failed.", err));
  activeUnsubscribers.push(unsubStaff);

  // Inventory (shared between owner + staff views)
  const inventoryQuery = query(collection(db, "inventory"), orderBy("name"));
  const unsubInventory = onSnapshot(inventoryQuery, (snapshot) => {
    ownerStatInventory.textContent = String(snapshot.size);
    const items = snapshot.docs.map(d => ({
      name: d.data().name,
      meta: `${d.data().quantity ?? 0} in stock · $${Number(d.data().price ?? 0).toFixed(2)} ${d.data().unit || ""}`.trim()
    }));
    renderInventoryList(ownerInventoryList, items);
    renderInventoryList(staffInventoryList, items);
  }, (err) => console.error("A-Play: inventory listener failed.", err));
  activeUnsubscribers.push(unsubInventory);

  // Active check-ins (guests currently on-site)
  const activeCheckinsQuery = query(collection(db, "checkins"), where("status", "==", "active"));
  const unsubCheckins = onSnapshot(activeCheckinsQuery, (snapshot) => {
    ownerStatGuests.textContent = String(snapshot.size);
  }, (err) => console.error("A-Play: check-in count listener failed.", err));
  activeUnsubscribers.push(unsubCheckins);

  // Today's revenue — summed client-side from today's orders.
  // NOTE: for a resort with meaningful order volume, this sum
  // should move to a Firebase Cloud Function that maintains a
  // rolling aggregate document; that's listed as a "later" piece
  // of infrastructure in the project requirements.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const ordersQuery = query(collection(db, "orders"), where("createdAt", ">=", startOfToday));
  const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
    let total = 0;
    snapshot.forEach(d => { total += Number(d.data().total || 0); });
    ownerStatRevenue.textContent = `$${total.toFixed(2)}`;
  }, (err) => console.error("A-Play: revenue listener failed.", err));
  activeUnsubscribers.push(unsubOrders);
}

/* Shared helper for every window.prompt() call in this file: treats
   a cancelled prompt (null) and a whitespace-only entry the same way
   — as "nothing was entered" — instead of letting "   " slip through
   a plain `if(!value)` check as if it were valid input. */
function sanitizePromptText(raw){
  if(raw === null) return null; // user hit Cancel
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

ownerInviteStaffBtn.addEventListener("click", async () => {
  const email = sanitizePromptText(window.prompt("Email address for the new staff member:"));
  if(!email) return; // cancelled or blank/whitespace-only — nothing to do
  if(!EMAIL_PATTERN.test(email)){
    showToast("Enter a valid email address");
    return;
  }
  try{
    // A client app cannot create a second Firebase Auth account
    // without signing the current owner out (createUserWithEmailAndPassword
    // signs in as the newly created user). We record a pending invite
    // here; turning it into a real account is a Firebase Cloud Function
    // job (listed under "future" infrastructure in the project scope).
    await addDoc(collection(db, "staffInvites"), {
      email,
      role: "staff",
      status: "pending",
      invitedAt: serverTimestamp()
    });
    showToast("Staff invite recorded — provision the account in Firebase to finish onboarding");
  }catch(err){
    console.error("A-Play: staff invite failed.", err);
    showToast("Could not record the invite — please try again");
  }
});

ownerAddInventoryBtn.addEventListener("click", async () => {
  const name = sanitizePromptText(window.prompt("Item name:"));
  if(!name) return; // cancelled or blank/whitespace-only

  const priceRaw = window.prompt("Price (USD):");
  if(priceRaw === null) return; // user cancelled — do not silently default to $0
  const price = Number(priceRaw);
  if(!Number.isFinite(price) || price < 0){
    showToast("Enter a valid, non-negative price to add this item");
    return;
  }

  const unit = sanitizePromptText(window.prompt("Unit (e.g. per cup, per bag):")) || "";

  const quantityRaw = window.prompt("Starting quantity:");
  if(quantityRaw === null) return; // user cancelled
  const parsedQuantity = Number(quantityRaw);
  const quantity = Number.isFinite(parsedQuantity) && parsedQuantity >= 0 ? parsedQuantity : 0;

  try{
    await addDoc(collection(db, "inventory"), {
      name,
      price,
      unit,
      quantity,
      createdAt: serverTimestamp()
    });
    showToast(`${name} added to inventory`);
  }catch(err){
    console.error("A-Play: adding inventory item failed.", err);
    showToast("Could not add that item — please try again");
  }
});

/* ============================================================
   STAFF DASHBOARD
============================================================ */
function startStaffListeners(){
  const inventoryQuery = query(collection(db, "inventory"), orderBy("name"));
  const unsubInventory = onSnapshot(inventoryQuery, (snapshot) => {
    const items = snapshot.docs.map(d => ({
      name: d.data().name,
      meta: `${d.data().quantity ?? 0} in stock · $${Number(d.data().price ?? 0).toFixed(2)} ${d.data().unit || ""}`.trim()
    }));
    renderInventoryList(staffInventoryList, items);
  }, (err) => console.error("A-Play: staff inventory listener failed.", err));
  activeUnsubscribers.push(unsubInventory);

  const activeCheckinsQuery = query(collection(db, "checkins"), where("status", "==", "active"));
  const unsubCheckins = onSnapshot(activeCheckinsQuery, (snapshot) => {
    renderRosterList(staffActiveGuestList, snapshot.docs.map(d => ({
      name: d.data().guestName || "Guest",
      meta: "Checked in",
      active: true
    })));
  }, (err) => console.error("A-Play: active guest listener failed.", err));
  activeUnsubscribers.push(unsubCheckins);
}

staffCheckInBtn.addEventListener("click", async () => {
  const phoneInput = staffScanInput.value.trim();
  if(!phoneInput){
    showToast("Enter a guest phone number or pass ID first");
    return;
  }
  try{
    const usersQuery = query(collection(db, "users"), where("phone", "==", phoneInput));
    const snapshot = await getDocsOnce(usersQuery);
    if(snapshot.empty){
      showToast("No guest found with that phone number");
      return;
    }
    const guestDoc = snapshot.docs[0];
    const guestName = guestDoc.data().fullName || "Guest";

    await addDoc(collection(db, "checkins"), {
      guestId: guestDoc.id,
      guestName,
      status: "active",
      checkedInAt: serverTimestamp(),
      checkedOutAt: null
    });

    showToast(`${guestName} checked in`);
    staffScanInput.value = "";
  }catch(err){
    console.error("A-Play: check-in failed.", err);
    showToast("Check-in failed — please try again");
  }
});

staffCheckOutBtn.addEventListener("click", async () => {
  const queryValue = staffScanInput.value.trim();
  if(!queryValue){
    showToast("Enter a guest phone number or pass ID first");
    return;
  }
  try{
    const usersQuery = query(collection(db, "users"), where("phone", "==", queryValue));
    const userSnapshot = await getDocsOnce(usersQuery);
    if(userSnapshot.empty){
      showToast("No guest found with that phone number");
      return;
    }
    const guestId = userSnapshot.docs[0].id;

    const activeCheckinQuery = query(
      collection(db, "checkins"),
      where("guestId", "==", guestId),
      where("status", "==", "active")
    );
    const checkinSnapshot = await getDocsOnce(activeCheckinQuery);
    if(checkinSnapshot.empty){
      showToast("This guest doesn't have an active check-in");
      return;
    }

    await updateDoc(doc(db, "checkins", checkinSnapshot.docs[0].id), {
      status: "checked-out",
      checkedOutAt: serverTimestamp()
    });

    showToast("Guest checked out");
    staffScanInput.value = "";
  }catch(err){
    console.error("A-Play: check-out failed.", err);
    showToast("Check-out failed — please try again");
  }
});

/* Small wrapper so the check-in/out handlers above read clearly
   as "get this query's results once" versus the onSnapshot-based
   live listeners used everywhere else in this file. */
function getDocsOnce(q){
  return getDocs(q);
}

/* ============================================================
   PARENT DASHBOARD
============================================================ */
function renderParentDashboard(profile){
  const child = profile.childProfile;
  if(child){
    parentPassChildName.textContent = child.fullName || "—";
    parentPassTier.textContent = child.pass ? `${child.pass.name} — $${Number(child.pass.price).toFixed(2)}` : "No pass on file";
    parentChildName.textContent = child.fullName || "—";
    parentChildAge.textContent = child.age != null ? String(child.age) : "—";
    parentChildWeight.textContent = child.weight != null ? `${child.weight} lbs` : "—";
  }else{
    parentPassChildName.textContent = "No child profile on file";
    parentPassTier.textContent = "Contact the front desk to add one";
    parentChildName.textContent = "—";
    parentChildAge.textContent = "—";
    parentChildWeight.textContent = "—";
  }
}

function startParentHistoryListener(uid){
  const historyQuery = query(
    collection(db, "checkins"),
    where("guestId", "==", uid),
    orderBy("checkedInAt", "desc")
  );
  const unsub = onSnapshot(historyQuery, (snapshot) => {
    renderRosterList(parentVisitHistory, snapshot.docs.map(d => ({
      name: d.data().status === "active" ? "Currently checked in" : "Visit completed",
      meta: formatTimestamp(d.data().checkedInAt),
      active: d.data().status === "active"
    })));
  }, (err) => console.error("A-Play: visit history listener failed.", err));
  activeUnsubscribers.push(unsub);
}

/* ============================================================
   GUEST DASHBOARD
============================================================ */
function renderGuestDashboard(profile){
  guestPassName.textContent = profile.fullName || "Guest";
  guestPassTier.textContent = profile.passTier
    ? `${profile.passTier.name} — $${Number(profile.passTier.price).toFixed(2)}`
    : "No pass on file";
  guestZoneInfo.textContent = "Zone status is shared live by front-desk staff — check back or ask at the desk.";
}

/* ============================================================
   RENDER HELPERS (roster / inventory lists)
============================================================ */
function renderRosterList(container, rows){
  if(!container) return;
  if(rows.length === 0){
    container.innerHTML = `<div class="list-empty-state">${container.dataset.emptyLabel || "Nothing here yet."}</div>`;
    return;
  }
  container.innerHTML = rows.map(row => `
    <div class="roster-row">
      <div>
        <div class="roster-row-name">${escapeHtml(row.name)}</div>
        <div class="roster-row-meta">${escapeHtml(row.meta || "")}</div>
      </div>
      <span class="roster-row-status ${row.active ? "status-active" : "status-inactive"}">
        ${row.active ? "Active" : "Inactive"}
      </span>
    </div>
  `).join("");
}

function renderInventoryList(container, rows){
  if(!container) return;
  if(rows.length === 0){
    container.innerHTML = `<div class="list-empty-state">${container.dataset.emptyLabel || "Nothing here yet."}</div>`;
    return;
  }
  container.innerHTML = rows.map(row => `
    <div class="inventory-row">
      <div>
        <div class="inventory-row-name">${escapeHtml(row.name)}</div>
        <div class="inventory-row-meta">${escapeHtml(row.meta || "")}</div>
      </div>
    </div>
  `).join("");
}

function formatTimestamp(ts){
  if(!ts || typeof ts.toDate !== "function") return "Just now";
  return ts.toDate().toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

/* ============================================================
   PAYMENT WALLET HANDOFF
   payment-wallet.js owns all order/payment logic. We hand it the
   Firebase references it needs once, here, so it never has to
   re-initialize Firebase itself.
============================================================ */
initPaymentWallet({ db, auth, showToast });
