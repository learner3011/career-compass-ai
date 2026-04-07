function getApiBase() {
  const override = localStorage.getItem("careerCompassApiBaseUrl");
  if (override) return override.replace(/\/$/, "");
  if (window.location.protocol === "file:") return "http://localhost:5000";
  if ((window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port !== "5000") {
    return `${window.location.protocol}//${window.location.hostname}:5000`;
  }
  return window.location.origin;
}

document.addEventListener("DOMContentLoaded", () => {
  const API = getApiBase();
  const params = new URLSearchParams(window.location.search);
  const emailInput = document.getElementById("email");
  const resendBtn = document.getElementById("resendBtn");
  const verifyBtn = document.getElementById("verifyBtn");
  let resendCountdown = 30;
  let resendTimer;

  emailInput.value = params.get("email") || "";

  function setStatus(message) {
    document.getElementById("status").innerText = message || "";
  }

  function setHelper(message) {
    document.getElementById("helper").innerText = message || "";
  }

  function startResendCooldown(seconds = 30) {
    clearInterval(resendTimer);
    resendCountdown = seconds;
    resendBtn.disabled = true;
    resendBtn.innerText = `Resend in ${resendCountdown}s`;
    setHelper("Please wait before requesting another code.");

    resendTimer = setInterval(() => {
      resendCountdown -= 1;

      if (resendCountdown <= 0) {
        clearInterval(resendTimer);
        resendBtn.disabled = false;
        resendBtn.innerText = "Resend Code";
        setHelper("");
        return;
      }

      resendBtn.innerText = `Resend in ${resendCountdown}s`;
    }, 1000);
  }

  async function verifyEmail() {
    const email = emailInput.value.trim();
    const code = document.getElementById("code").value.trim();

    if (!email || !code) {
      alert("Enter email and verification code");
      return;
    }

    setStatus("Verifying...");

    try {
      const res = await fetch(`${API}/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("");
        alert(data.error || "Verification failed");
        return;
      }

      if (data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("careerCompassUserEmail", data.email || email);
      }

      setStatus("Email verified. Redirecting to home...");
      setTimeout(() => {
        window.location.href = "home.html";
      }, 1200);
    } catch {
      setStatus("");
      alert("Unable to reach the server. Please try again.");
    }
  }

  async function resendCode() {
    const email = emailInput.value.trim();

    if (!email) {
      alert("Enter email first");
      return;
    }

    if (resendBtn.disabled) {
      return;
    }

    setStatus("Sending a new code...");

    try {
      const res = await fetch(`${API}/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("");
        alert(data.error || "Unable to resend code");
        return;
      }

      setStatus(data.message || "Verification code sent again.");
      startResendCooldown();
    } catch {
      setStatus("");
      alert("Unable to reach the server. Please try again.");
    }
  }

  verifyBtn.addEventListener("click", verifyEmail);
  resendBtn.addEventListener("click", resendCode);
  startResendCooldown();
});
