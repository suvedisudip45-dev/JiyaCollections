/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { Sparkles, Gift, CheckCircle2 } from "lucide-react";

export const DigitalScratchCard = ({
  hasBenefit = false,
  benefit = null,
  partner = {},
  onRevealed = () => {},
}) => {
  const canvasRef = useRef(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isScratching, setIsScratching] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.offsetWidth || 340;
    const height = canvas.offsetHeight || 220;
    canvas.width = width;
    canvas.height = height;

    // Draw metallic silver-gold foil background
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, "#94a3b8");
    grad.addColorStop(0.3, "#cbd5e1");
    grad.addColorStop(0.5, "#e2e8f0");
    grad.addColorStop(0.7, "#cbd5e1");
    grad.addColorStop(1, "#64748b");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Decorative pattern & instructions
    ctx.fillStyle = "#334155";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("✨ SCRATCH TO REVEAL ✨", width / 2, height / 2 - 10);

    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#475569";
    ctx.fillText("Rub with mouse or touch", width / 2, height / 2 + 15);

    // Subtle border
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, width - 12, height - 12);
  }, []);

  const checkScratchPercentage = () => {
    if (isRevealed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const pixels = imgData.data;
    let transparentCount = 0;
    const totalPixels = pixels.length / 4;

    // Sample every 4th pixel for performance
    for (let i = 3; i < pixels.length; i += 16) {
      if (pixels[i] < 128) {
        transparentCount += 4;
      }
    }

    const currentPct = Math.round((transparentCount / totalPixels) * 100);
    setProgress(Math.min(100, currentPct * 2));

    if (currentPct > 35) {
      setIsRevealed(true);
      ctx.clearRect(0, 0, width, height);
      if (hasBenefit) {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ["#f59e0b", "#10b981", "#6366f1", "#ec4899"],
        });
      }
      onRevealed();
    }
  };

  const scratch = (clientX, clientY) => {
    if (isRevealed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();

    checkScratchPercentage();
  };

  const handleMouseMove = (e) => {
    if (!isScratching) return;
    scratch(e.clientX, e.clientY);
  };

  const handleTouchMove = (e) => {
    if (!e.touches[0]) return;
    scratch(e.touches[0].clientX, e.touches[0].clientY);
  };

  return (
    <div className="relative mx-auto w-full max-w-sm rounded-2xl overflow-hidden border-2 border-slate-900 bg-white shadow-xl select-none">
      {/* Underlying Reward Content */}
      <div className="p-6 text-center flex flex-col justify-center items-center min-h-[220px] bg-gradient-to-b from-amber-50/50 to-white">
        {hasBenefit && benefit ? (
          <div className="space-y-3 animate-fade-in">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-200">
              <Gift className="h-7 w-7" />
            </div>
            <div>
              <span className="rounded-full bg-emerald-100 border border-emerald-300 px-3 py-1 text-[10px] font-black uppercase text-emerald-800">
                🎉 Congratulations!
              </span>
              <h3 className="mt-2 text-lg font-black text-slate-900">
                {benefit.name}
              </h3>
              {benefit.description && (
                <p className="text-xs text-slate-600 mt-1 max-w-[260px]">
                  {benefit.description}
                </p>
              )}
            </div>
            <p className="text-[11px] font-bold text-amber-700">
              Partner: {partner.name || "Brand Partner"}
            </p>
          </div>
        ) : (
          <div className="space-y-2 py-4">
            <span className="text-3xl">🍀</span>
            <h3 className="text-base font-black text-slate-800">
              Better Luck Next Time!
            </h3>
            <p className="text-xs text-slate-500 max-w-[240px]">
              Thank you for shopping with Aama Clothings. Look out for rewards in future orders!
            </p>
          </div>
        )}
      </div>

      {/* Scratch Canvas Overlay */}
      {!isRevealed && (
        <canvas
          ref={canvasRef}
          onMouseDown={() => setIsScratching(true)}
          onMouseUp={() => setIsScratching(false)}
          onMouseLeave={() => setIsScratching(false)}
          onMouseMove={handleMouseMove}
          onTouchStart={() => setIsScratching(true)}
          onTouchEnd={() => setIsScratching(false)}
          onTouchMove={handleTouchMove}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none transition-opacity duration-300"
        />
      )}

      {/* Quick Reveal button for convenience */}
      {!isRevealed && (
        <div className="absolute bottom-2 right-2">
          <button
            type="button"
            onClick={() => {
              setIsRevealed(true);
              const canvas = canvasRef.current;
              if (canvas) {
                const ctx = canvas.getContext("2d");
                ctx?.clearRect(0, 0, canvas.width, canvas.height);
              }
              if (hasBenefit) {
                confetti({ particleCount: 50, spread: 60 });
              }
              onRevealed();
            }}
            className="rounded-lg bg-slate-900/80 px-2 py-1 text-[9px] font-bold text-white backdrop-blur hover:bg-slate-900"
          >
            Auto Reveal
          </button>
        </div>
      )}
    </div>
  );
};

export default DigitalScratchCard;
