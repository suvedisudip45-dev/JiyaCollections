/* eslint-disable react/prop-types */
import { useEffect } from "react";
import NcmDeliveryDetails from "./NcmDeliveryDetails";
import SelfDeliveryDetails from "./SelfDeliveryDetails";

const DeliveryRecordDetails = ({ token, mode, recordId, row, onClose }) => {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40" role="dialog" aria-modal="true" aria-label="Delivery details">
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} aria-label="Close delivery details" />
      <aside className="relative z-10 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        {mode === "ncm"
          ? <NcmDeliveryDetails token={token} recordId={recordId} row={row} onClose={onClose} />
          : <SelfDeliveryDetails token={token} recordId={recordId} onClose={onClose} />}
      </aside>
    </div>
  );
};

export default DeliveryRecordDetails;
