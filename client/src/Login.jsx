import React from 'react';
import './Login.css';

function Login() {
  return (
    <div className="login-container">
      <div className="login-box">
        <h1>🧠 Knowledge Navigator</h1>
        <p>Please sign in to continue</p>
        <div className="login-buttons">
          <a href="http://localhost:3001/auth/google" className="login-button google">
            Sign in with Google
          </a>
          <a href="http://localhost:3001/auth/github" className="login-button github">
            Sign in with GitHub
          </a>
        </div>
      </div>
    </div>
  );
}

export default Login;
