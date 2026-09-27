/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useState } from "react";
import axios from "axios";
import { backendUrl } from "../App";
import { toast } from "react-toastify";
import CryptoJS from "crypto-js";
import { storeAuthTokens } from "../auth/tokenStorage";

const encryptValue = (plaintext) => {
  const keyHex = import.meta.env.VITE_AES_KEY;
  const key = CryptoJS.enc.Hex.parse(keyHex);
  const iv = CryptoJS.enc.Hex.parse(import.meta.env.VITE_AES_IV);
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.ciphertext.toString(CryptoJS.enc.Base64);
};

const Login = ({ setToken }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("credentials");
  const [challenge, setChallenge] = useState(null);
  const [method, setMethod] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmitHandler = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (step === "credentials") {
        const response = await axios.post(backendUrl + "/api/auth/login", {
          email: email.trim().toLowerCase(),
          targetPortal: encryptValue("ADMIN"),
          encryptedPassword: encryptValue(password),
        }, { withCredentials: true });
        if (response.data.requiresTwoFactor) {
          setChallenge(response.data);
          setMethod(response.data.availableMethods?.[0] || "");
          setStep("method");
          return;
        }
        if (response.data.success && (response.data.accessToken || response.data.token)) {
          setToken(storeAuthTokens(response.data));
          return;
        }
        throw new Error(response.data.message || "Authentication failed.");
      }

      if (step === "method") {
        const response = await axios.post(`${backendUrl}/api/auth/admin/2fa/send`, {
          challengeId: challenge.challengeId,
          method,
        });
        if (!response.data?.success) throw new Error(response.data?.message || "Could not queue verification code.");
        toast.info(response.data.message || "Verification code queued for delivery.");
        setStep("otp");
        return;
      }

      const response = await axios.post(`${backendUrl}/api/auth/admin/2fa/verify`, {
        challengeId: challenge.challengeId,
        otp,
      }, { withCredentials: true });
      if (!response.data?.success || !(response.data.accessToken || response.data.token)) {
        throw new Error(response.data?.message || "Invalid or expired verification code.");
      }
      setToken(storeAuthTokens(response.data));
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  const restartLogin = () => {
    setChallenge(null);
    setMethod("");
    setOtp("");
    setStep("credentials");
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

        {step === "credentials" && (
          <form onSubmit={onSubmitHandler} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
              <input
                onChange={(e) => setEmail(e.target.value)}
                value={email}
                className="rounded-lg w-full px-3 py-2.5 border border-gray-300 outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition text-sm"
                type="email"
                autoComplete="username"
                placeholder="your@email.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <input
                onChange={(e) => setPassword(e.target.value)}
                value={password}
                className="rounded-lg w-full px-3 py-2.5 border border-gray-300 outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition text-sm"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
            </div>
            <button disabled={loading} className="mt-2 w-full py-2.5 px-4 rounded-lg text-white bg-slate-900 hover:bg-slate-700 transition-all font-medium flex items-center justify-center gap-2 disabled:opacity-50" type="submit">
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Continue
            </button>
          </form>
        )}

        {step === "method" && (
          <form onSubmit={onSubmitHandler} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Verify it&apos;s you</h2>
              <p className="mt-1 text-sm text-slate-500">Choose where to receive your verification code.</p>
            </div>
            <div className="space-y-2">
              {challenge?.availableMethods?.map((availableMethod) => {
                const destination = availableMethod === "SMS" ? challenge.maskedPhone : challenge.maskedEmail;
                return (
                  <label key={availableMethod} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${method === availableMethod ? "border-slate-800 bg-slate-50" : "border-slate-200"}`}>
                    <input type="radio" name="verification-method" value={availableMethod} checked={method === availableMethod} onChange={() => setMethod(availableMethod)} />
                    <span className="text-sm font-medium text-slate-800">{availableMethod === "SMS" ? "Text message" : "Email"}</span>
                    <span className="ml-auto break-all text-right text-xs text-slate-500">{destination}</span>
                  </label>
                );
              })}
            </div>
            <button disabled={loading || !method} className="w-full rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white disabled:opacity-50" type="submit">
              {loading ? "Queuing code..." : "Send verification code"}
            </button>
            <button className="w-full py-2 text-sm text-slate-500 hover:text-slate-900" type="button" onClick={restartLogin}>Back to sign in</button>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={onSubmitHandler} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Enter verification code</h2>
              <p className="mt-1 text-sm text-slate-500">Enter the code sent using your selected method.</p>
            </div>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
              className="w-full rounded-lg border border-gray-300 px-3 py-3 text-center text-xl tracking-[0.3em] outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Verification code"
              required
            />
            <button disabled={loading || otp.length < 6} className="w-full rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white disabled:opacity-50" type="submit">
              {loading ? "Verifying..." : "Verify and sign in"}
            </button>
            <button className="w-full py-2 text-sm text-slate-500 hover:text-slate-900" type="button" onClick={restartLogin}>Start again</button>
          </form>
        )}

        <p className="text-xs text-slate-400 text-center mt-5">
          Credentials encrypted with AES-256 in transit
        </p>
      </div>
    </div>
  );
};

export default Login;
