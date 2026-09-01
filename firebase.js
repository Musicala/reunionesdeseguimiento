// firebase.js — Actas Musicala (CORREGIDO)
// --------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBld9AaA4OyRxB_NV7ZPpqJXoMkzJYcdgo",
  authDomain: "reuniones-de-seguimiento-adm.firebaseapp.com",
  projectId: "reuniones-de-seguimiento-adm",
  storageBucket: "reuniones-de-seguimiento-adm.firebasestorage.app",
  messagingSenderId: "323361775727",
  appId: "1:323361775727:web:eb9c382723305d78822d9a"
};

// Inicializar app
export const app = initializeApp(firebaseConfig);

// Inicializar Firestore (UNA SOLA VEZ)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// Autenticación con Google
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Evita que Google reutilice silenciosamente otra sesión del navegador.
googleProvider.setCustomParameters({ prompt: "select_account" });

// Correos autorizados a usar la app.
// (En minúsculas. Debe coincidir con la lista en firestore.rules)
export const ALLOWED_EMAILS = [
  "imusicala@gmail.com",
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com"
];
