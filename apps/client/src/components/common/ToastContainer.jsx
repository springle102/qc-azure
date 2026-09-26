import React, { useState, useEffect } from 'react';
import { IconCheckCircle, IconAlertTriangle, IconX } from './Icons';

// Global toast dispatch helper
let toastDispatch = null;

export const showToast = (message, type = 'success', duration = 3500) => {
  if (toastDispatch) {
    toastDispatch({ id: Date.now(), message, type, duration });
  }
};

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    toastDispatch = (toast) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, toast.duration);
    };
    return () => {
      toastDispatch = null;
    };
  }, []);

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="toast-container" style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      pointerEvents: 'none'
    }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-item toast-${toast.type}`}
          style={{
            pointerEvents: 'auto',
            minWidth: '300px',
            maxWidth: '420px',
            background: 'rgba(10, 17, 34, 0.95)',
            border: toast.type === 'error'
              ? '1px solid rgba(239, 68, 68, 0.5)'
              : '1px solid rgba(59, 130, 246, 0.5)',
            borderRadius: '12px',
            padding: '14px 18px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.6), 0 0 20px rgba(59, 130, 246, 0.25)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            color: '#f8fafc',
            animation: 'toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {toast.type === 'error' ? (
              <IconAlertTriangle size={20} className="text-red-400" />
            ) : (
              <IconCheckCircle size={20} className="text-cyan-400" />
            )}
            <span style={{ fontSize: '14px', fontWeight: 500, lineHeight: 1.4 }}>{toast.message}</span>
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex'
            }}
          >
            <IconX size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
