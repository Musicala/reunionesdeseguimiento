// firebase.js — Actas Musicala (CORREGIDO)
// --------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
