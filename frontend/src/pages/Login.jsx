import React, { useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import axios from "axios";
import { toast } from "react-toastify";
import TermsAndConditionsModal from "../components/TermsAndConditionsModal";
import CryptoJS from "crypto-js";

// Encrypt a plaintext password with AES-256-CBC using a random IV
const encryptPassword = (plaintext) => {
  const keyHex = import.meta.env.VITE_AES_KEY;
  const key = CryptoJS.enc.Hex.parse(keyHex);
  const iv = CryptoJS.lib.WordArray.random(16); // 128-bit random IV
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

const isValidNepalMobileNumber = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.replace(/^0+/, "").replace(/^977/, "");
  return /^9[78]\d{8}$/.test(normalized);
};

const Login = () => {
  const [currentState, setCurrentState] = useState("Login");
  const { token, setToken, navigate, backendUrl } = useContext(ShopContext);
  const location = useLocation();
  const redirectTo = location.state?.from || "/";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState("PREFER_NOT_TO_SAY");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showExistingClient, setShowExistingClient] = useState(false);
  const [existingCustomerPhone, setExistingCustomerPhone] = useState("");
  const [existingCustomerCode, setExistingCustomerCode] = useState("");
  const [validatedExistingCustomer, setValidatedExistingCustomer] = useState(null);

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    if (currentState === "Sign Up" && showExistingClient) {
      if (!validatedExistingCustomer) {
        if (!existingCustomerPhone.trim() || !existingCustomerCode.trim()) {
          toast.error("Please enter your mobile number and secret code first.");
          return;
        }
        if (!isValidNepalMobileNumber(existingCustomerPhone)) {
          toast.error("Please enter a valid mobile number starting with 98 or 97.");
          return;
        }

        try {
          setLoading(true);
          const response = await axios.post(backendUrl + "/api/user/social/validate", {
            phone: existingCustomerPhone.trim(),
            code: existingCustomerCode.trim(),
          });

          if (response.data.success && response.data.customer) {
            const customer = response.data.customer;
            setValidatedExistingCustomer(customer);
            setPhone(existingCustomerPhone.trim());
            setFirstName(customer.firstName || "");
            setLastName(customer.lastName || "");
            setGender(customer.gender || "PREFER_NOT_TO_SAY");
            setEmail(customer.email || "");
            toast.success("Customer verified. Please complete the account setup.");
            return;
          }

          toast.error(response.data.message || "Unable to verify your account");
          return;
        } catch (error) {
          console.log(error);
          toast.error(error.response?.data?.message || error.message);
          return;
        } finally {
          setLoading(false);
        }
      }

      if (!email.trim()) {
        toast.error("Please enter your email address");
        return;
      }
      if (!password || password.length < 8) {
        toast.error("Please enter a strong password with at least 8 characters");
        return;
      }
      if (!firstName.trim() || !lastName.trim()) {
        toast.error("Please confirm your first and last name");
        return;
      }
      if (!agreeTerms) {
        toast.error("Please agree to the Terms & Conditions to continue");
        return;
      }

      try {
        setLoading(true);
        const response = await axios.post(backendUrl + "/api/user/social/activate", {
          phone: existingCustomerPhone.trim(),
          code: existingCustomerCode.trim(),
          email: email.trim().toLowerCase(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          gender,
        });

        if (response.data.success) {
          setToken(response.data.token);
          localStorage.setItem("token", response.data.token);
          toast.success("Welcome back! Your loyalty profile has been restored.");
        } else {
          toast.error(response.data.message || "Unable to activate your customer account");
        }
      } catch (error) {
        console.log(error);
        toast.error(error.response?.data?.message || error.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (currentState === "Sign Up") {
      if (!firstName.trim()) {
        toast.error("Please enter your first name");
        return;
      }
      if (!lastName.trim()) {
        toast.error("Please enter your last name");
        return;
      }
      if (!showExistingClient && !isValidNepalMobileNumber(phone)) {
        toast.error("Please enter a valid mobile number starting with 98 or 97.");
        return;
      }
      if (!agreeTerms) {
        toast.error("Please agree to the Terms & Conditions to register");
        return;
      }
    }

    try {
      setLoading(true);
      if (currentState === "Sign Up") {
        const response = await axios.post(backendUrl + "/api/user/register", {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          gender,
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          password,
        });
        if (response.data.success) {
          setToken(response.data.token);
          localStorage.setItem("token", response.data.token);
          toast.success("Account created successfully!");
        } else {
          toast.error(response.data.message);
        }
      } else {
        // AES-encrypt password before sending over the wire
        const { encryptedPassword, iv } = encryptPassword(password);
        const response = await axios.post(backendUrl + "/api/user/login", {
          email: email.trim().toLowerCase(),
          encryptedPassword,
          iv,
        });
        if (response.data.success) {
          setToken(response.data.token);
          localStorage.setItem("token", response.data.token);
          toast.success("Logged in successfully!");
        } else {
          toast.error(response.data.message);
        }
      }
    } catch (error) {
      console.log(error);
      toast.error(error.response?.data?.message || error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      navigate(redirectTo, { replace: true });
    }
  }, [token, redirectTo]);

  return (
    <>
      <form
        onSubmit={onSubmitHandler}
        className="flex flex-col items-center w-[90%] sm:max-w-[420px] m-auto mt-14 gap-4 text-gray-800 bg-white p-6 sm:p-8 rounded-2xl border border-gray-100 shadow-sm"
      >
        {redirectTo === "/place-order" && (
          <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 text-center mb-1">
            🛒 <span className="font-semibold">Checkout in progress</span>: Log in or create an account to proceed directly with your order.
          </div>
        )}

        <div className="inline-flex items-center gap-2 mb-2 mt-2">
          <p className="prata-regular text-3xl">{currentState}</p>
          <hr className="border-none h-[1.5px] w-8 bg-gray-800" />
        </div>


        {currentState === "Sign Up" && (
          <button
            type="button"
            onClick={() => {
              setShowExistingClient((prev) => !prev);
              setValidatedExistingCustomer(null);
              setExistingCustomerPhone("");
              setExistingCustomerCode("");
            }}
            className="w-full text-left text-xs font-medium text-slate-700 hover:text-black underline underline-offset-2"
          >
            {showExistingClient ? "Create a new account instead" : "Already a client? Continue with your code"}
          </button>
        )}

        {currentState === "Sign Up" && showExistingClient && (
          <div className="w-full space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              Existing customer verification
            </div>

            {!validatedExistingCustomer ? (
              <>
                <input
                  onChange={(e) => setExistingCustomerPhone(e.target.value.replace(/[^0-9]/g, ""))}
                  value={existingCustomerPhone}
                  type="tel"
                  className="w-full px-3 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 bg-white"
                  placeholder="Contact number"
                  required
                />
                <input
                  onChange={(e) => setExistingCustomerCode(e.target.value.toUpperCase())}
                  value={existingCustomerCode}
                  type="text"
                  className="w-full px-3 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 bg-white uppercase"
                  placeholder="Code"
                  required
                />
              </>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-[11px] text-emerald-700">
                Verified customer: <span className="font-semibold">{validatedExistingCustomer.firstName || ""} {validatedExistingCustomer.lastName || ""}</span>
              </div>
            )}
          </div>
        )}

        {currentState === "Sign Up" && showExistingClient && validatedExistingCustomer && (
          <>
            <div className="w-full flex gap-3">
              <input
                onChange={(e) => setFirstName(e.target.value)}
                value={firstName}
                type="text"
                className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-black"
                placeholder="First Name"
                required
              />
              <input
                onChange={(e) => setLastName(e.target.value)}
                value={lastName}
                type="text"
                className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-black"
                placeholder="Last Name"
                required
              />
            </div>

            <div className="w-full">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Gender</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-black bg-white"
              >
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
                <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
              </select>
            </div>
          </>
        )}

        {currentState === "Sign Up" && !(showExistingClient && !validatedExistingCustomer) && (
          <>
            {/* Email Input */}
            <input
              onChange={(e) => setEmail(e.target.value)}
              value={email}
              type="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-black"
              placeholder="Email address"
              required
            />

            {/* Phone Number Input for Sign Up */}
            {currentState === "Sign Up" && !showExistingClient && (
              <input
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))}
                value={phone}
                type="tel"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-black"
                placeholder="Phone number (e.g. 9800000000)"
                required
              />
            )}

            {/* Password Input */}
            <input
              onChange={(e) => setPassword(e.target.value)}
              value={password}
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-black"
              placeholder="Password (min 8 characters)"
              required
            />
          </>
        )}

        {currentState === "Sign Up" && showExistingClient && validatedExistingCustomer && (
          <div className="w-full">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
            <input
              onChange={(e) => setEmail(e.target.value)}
              value={email}
              type="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-black"
              placeholder="Email address"
              required
            />
          </div>
        )}

        {currentState === "Sign Up" && showExistingClient && validatedExistingCustomer && (
          <div className="w-full">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Password</label>
            <input
              onChange={(e) => setPassword(e.target.value)}
              value={password}
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-black"
              placeholder="Password (min 8 characters)"
              required
            />
          </div>
        )}

        {/* Terms and Conditions Checkbox for Sign Up */}
        {currentState === "Sign Up" && (
          <div className="w-full flex items-start gap-2 text-xs text-gray-600 mt-1">
            <input
              type="checkbox"
              id="agreeTerms"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-black border-gray-300 rounded focus:ring-black cursor-pointer"
            />
            <label htmlFor="agreeTerms" className="cursor-pointer select-none leading-relaxed">
              I have read and agree to the{" "}
              <button
                type="button"
                onClick={() => setIsTermsOpen(true)}
                className="text-black font-semibold underline hover:text-gray-700"
              >
                Terms & Conditions
              </button>
            </label>
          </div>
        )}

        {/* Switch Between Login and Sign Up */}
        <div className="w-full flex justify-between text-sm mt-1">
          {currentState === "Login" ? (
            <p className="cursor-pointer text-xs text-gray-500 hover:text-black">
              Forgot your password?
            </p>
          ) : (
            <div></div>
          )}

          {currentState === "Login" ? (
            <p
              onClick={() => setCurrentState("Sign Up")}
              className="cursor-pointer text-xs font-semibold text-black hover:underline"
            >
              Create account
            </p>
          ) : (
            <p
              onClick={() => setCurrentState("Login")}
              className="cursor-pointer text-xs font-semibold text-black hover:underline ml-auto"
            >
              Already have an account? Login
            </p>
          )}
        </div>

        {/* Submit Button */}
        <button
          disabled={loading}
          className="bg-black text-white font-medium px-8 py-2.5 mt-2 rounded-lg w-full hover:bg-gray-800 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading && (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          )}
          {currentState === "Login"
            ? "Sign In"
            : showExistingClient && !validatedExistingCustomer
              ? "Verify Customer"
              : showExistingClient
                ? "Finish Account Setup"
                : "Create Account"}
        </button>
      </form>

      {/* Terms and Conditions Modal */}
      <TermsAndConditionsModal
        isOpen={isTermsOpen}
        onClose={() => setIsTermsOpen(false)}
        onAccept={() => setAgreeTerms(true)}
      />
    </>
  );
};

export default Login;
