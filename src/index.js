import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { aplicarTemaAlDocumento } from './theme';

// El tema lo elige el usuario (no el sistema operativo), así que el CSS no lo
// puede deducir con prefers-color-scheme. Se copia a un atributo del <html>
// para que las reglas que no se pueden escribir inline —el relleno automático
// del navegador en el login, sobre todo— sepan en qué tema están.
aplicarTemaAlDocumento();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
