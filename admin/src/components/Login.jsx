/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useState } from "react";
import axios from "axios";
import { backendUrl } from "../App";
import { toast } from "react-toastify";
import CryptoJS from "crypto-js";
import { storeAuthTokens } from "../auth/tokenStorage";

// Encrypt a plaintext password with AES-256-CBC using a random IV
const encryptPassword = (plaintext) => {
  const keyHex = import.meta.env.VITE_AES_KEY;
  const key = CryptoJS.enc.Hex.parse(keyHex);
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return {
    encryptedPassword: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
    iv: iv.toString(CryptoJS.enc.Hex),
  };
};

const Login = ({ setToken }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmitHandler = async (e) => {
    try {
      e.preventDefault();
      setLoading(true);

      // AES-encrypt the password before sending
      const { encryptedPassword, iv } = encryptPassword(password);

      const response = await axios.post(backendUrl + "/api/auth/login", {
        email: email.trim().toLowerCase(),
        targetPortal: "ADMIN",
        encryptedPassword,
        iv,
      });
      if (response.data.success) {
        setToken(storeAuthTokens(response.data));
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center w-full bg-slate-50">
      <div className="bg-white shadow-lg rounded-2xl px-10 py-8 max-w-md w-full border border-slate-100">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="w-14 h-14 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-bold mx-auto mb-3 shadow">
            AC
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Panel</h1>
          <p className="text-sm text-slate-500 mt-1">Aama Clothings Management Console</p>
        </div>

        <form onSubmit={onSubmitHandler} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Email Address
            </label>
            <input
              onChange={(e) => setEmail(e.target.value)}
              value={email}
              className="rounded-lg w-full px-3 py-2.5 border border-gray-300 outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition text-sm"
              type="email"
              placeholder="your@email.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Password
            </label>
            <input
              onChange={(e) => setPassword(e.target.value)}
              value={password}
              className="rounded-lg w-full px-3 py-2.5 border border-gray-300 outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition text-sm"
              type="password"
              placeholder="Enter your password"
              required
            />
          </div>
          <button
            disabled={loading}
            className="mt-2 w-full py-2.5 px-4 rounded-lg text-white bg-slate-900 hover:bg-slate-700 active:scale-95 transition-all font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            type="submit"
          >
            {loading && (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            Sign In
          </button>
        </form>

        <p className="text-xs text-slate-400 text-center mt-5">
          🔒 Credentials encrypted with AES-256 in transit
        </p>
      </div>
    </div>
  );
};

export default Login;
