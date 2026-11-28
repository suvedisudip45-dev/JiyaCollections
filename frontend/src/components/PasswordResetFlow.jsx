/* eslint-disable react/prop-types */
import { useState } from "react";
import axios from "axios";

const PasswordResetFlow = ({ backendUrl, onBack, onComplete }) => {
  const [step, setStep] = useState("phone");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [otp, setOtp] = useState("");
  const [otpLength, setOtpLength] = useState(6);
  const [tfaToken, setTfaToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (step === "phone") {
        const response = await axios.post(`${backendUrl}/api/auth/password-reset/request`, {
          email,
          phone,
          portal: "CUSTOMER",
        });
        setChallengeId(response.data.challengeId);
        setMaskedPhone(response.data.maskedPhone);
        setOtpLength(response.data.otpLength || 6);
        setStep("otp");
      } else if (step === "otp") {
        const response = await axios.post(`${backendUrl}/api/auth/password-reset/verify`, {
          challengeId,
          otp,
          portal: "CUSTOMER",
        });
        setTfaToken(response.data.tfaToken);
        setStep("password");
      } else {
        const response = await axios.post(`${backendUrl}/api/auth/password-reset/complete`, {
          challengeId,
          tfaToken,
          newPassword,
          confirmPassword,
          portal: "CUSTOMER",
        });
        if (response.data.success) onComplete();
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Password recovery could not be completed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mx-auto mt-14 w-[90%] max-w-[420px] rounded-2xl border border-gray-100 bg-white p-6 text-gray-800 shadow-sm sm:p-8">
      <button type="button" onClick={onBack} className="mb-6 text-sm font-medium text-gray-500 hover:text-black">
        ← Back to sign in
      </button>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-sm text-gray-500">
        {step === "phone" && "Enter the email and mobile number linked to your customer account."}
        {step === "otp" && <>Enter the SMS code sent to <span className="font-semibold text-gray-800">{maskedPhone}</span>.</>}
        {step === "password" && "Choose a new password for your account."}
      </p>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        {step === "phone" && (
          <>
            <label htmlFor="customer-reset-email" className="block text-sm font-medium">Account email</label>
            <input
              id="customer-reset-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={255}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-black"
            />
            <label htmlFor="customer-reset-phone" className="block text-sm font-medium">Contact number</label>
            <input
              id="customer-reset-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              maxLength={16}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="98XXXXXXXX"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-black"
            />
            <p className="text-xs leading-5 text-gray-500">Both details must match an active customer account. We send a code by SMS only. Password reset is limited to once every 7 days and three times per month.</p>
          </>
        )}
        {step === "otp" && (
          <>
            <label htmlFor="customer-reset-otp" className="block text-sm font-medium">SMS verification code</label>
            <input
              id="customer-reset-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={otpLength}
              pattern={`[0-9]{${otpLength}}`}
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, otpLength))}
              placeholder={`${otpLength}-digit code`}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-black"
            />
          </>
        )}
        {step === "password" && (
          <>
            <label htmlFor="customer-new-password" className="block text-sm font-medium">New password</label>
            <input
              id="customer-new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-black"
            />
            <label htmlFor="customer-confirm-password" className="block text-sm font-medium">Confirm new password</label>
            <input
              id="customer-confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter new password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-black"
            />
          </>
        )}
        <button type="submit" disabled={loading} className="w-full rounded-lg bg-black px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50">
          {loading ? "Please wait..." : step === "phone" ? "Send SMS code" : step === "otp" ? "Verify code" : "Save new password"}
        </button>
      </form>
    </section>
  );
};

export default PasswordResetFlow;
