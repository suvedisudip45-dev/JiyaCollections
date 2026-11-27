import { useEffect, useRef } from "react";

const SignatureCapture = ({ value, onChange }) => {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasSignature = Boolean(value);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    if (!value) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return undefined;
    }
    const image = new Image();
    image.onload = () => {
      const currentCanvas = canvasRef.current;
      if (!currentCanvas) return;
      const currentContext = currentCanvas.getContext("2d");
      currentContext.clearRect(0, 0, currentCanvas.width, currentCanvas.height);
      currentContext.drawImage(image, 0, 0, currentCanvas.width, currentCanvas.height);
    };
    image.src = value;
    return () => { image.onload = null; };
  }, [value]);

  const getPoint = (event) => {
    const canvas = canvasRef.current;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  };

  const startDrawing = (event) => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const point = getPoint(event);
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#171717";
  };

  const draw = (event) => {
    if (!drawingRef.current) return;
    const point = getPoint(event);
    const context = canvasRef.current.getContext("2d");
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const stopDrawing = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(canvasRef.current.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    drawingRef.current = false;
    onChange("");
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-slate-800">Recipient signature (optional)</label>
        <button type="button" onClick={clear} disabled={!hasSignature && !value} className="text-xs font-semibold text-slate-600 underline disabled:opacity-40">
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={640}
        height={180}
        aria-label="Capture recipient signature"
        className="mt-2 h-32 w-full touch-none rounded-lg border border-slate-300 bg-white"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
      />
      <p className="mt-1 text-[11px] text-slate-500">Signature is sent securely with the delivery proof.</p>
    </div>
  );
};

export default SignatureCapture;
