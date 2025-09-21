import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Login from './Login'; // Import the new Login component
import './index.css';

// Configure axios to send cookies with every request
axios.defaults.withCredentials = true;

// A separate component for the main chat interface for clarity
const ChatInterface = ({ user, onLogout }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() && !file) return;

    const userMessage = { text: input, sender: 'user', fileName: file?.name };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    const formData = new FormData();
    formData.append('prompt', input);
    if (file) {
      formData.append('file', file);
    }

    setInput('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
      const response = await axios.post('http://localhost:3001/chat', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      const assistantMessage = { text: response.data.response, sender: 'assistant' };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage = { text: 'Sorry, something went wrong. Your session may have expired.', sender: 'assistant' };
      setMessages((prev) => [...prev, errorMessage]);
      console.error('Error fetching response:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <h1>🧠 Knowledge Navigator</h1>
          <p>Welcome, {user.name}!</p>
        </div>
        <button onClick={onLogout} className="logout-button">Logout</button>
      </header>
      <div className="chat-window">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.sender}`}>
            <div className="message-bubble">{msg.text}</div>
          </div>
        ))}
         {isLoading && (
         <div className="message assistant">
           <div className="message-bubble loading-bubble">
             <span></span><span></span><span></span>
           </div>
         </div>
      )}
      </div>
      <form onSubmit={handleSubmit} className="input-form">
        <input type="file" onChange={(e) => setFile(e.target.files[0])} ref={fileInputRef} />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything..."
          className="text-input"
          disabled={isLoading}
        />
        <button type="submit" className="send-button" disabled={isLoading || (!input.trim() && !file)}>Send</button>
      </form>
    </div>
  );
};

function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // Check the user's auth status when the app loads
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const response = await axios.get('http://localhost:3001/auth/status');
        setUser(response.data.user);
      } catch (error) {
        console.log('User not authenticated or session expired', error);
        setUser(null);
      } finally {
        setLoadingAuth(false);
      }
    };
    checkAuthStatus();
  }, []);

  const handleLogout = async () => {
    try {
      await axios.post('http://localhost:3001/auth/logout');
      setUser(null);
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  if (loadingAuth) {
    return <div className="loading-auth">Loading...</div>;
  }

  // Conditionally render Login or the Chat Interface
  return user ? <ChatInterface user={user} onLogout={handleLogout} /> : <Login />;
}

export default App;
