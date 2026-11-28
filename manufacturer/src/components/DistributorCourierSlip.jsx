import React from "react";
import { Printer, X } from "lucide-react";
import { currency, useManufacturer } from "../context/ManufacturerContext";
import "./DistributorCourierSlip.css";

const formatMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `${currency}${amount.toLocaleString("en-NP", { maximumFractionDigits: 2 })}`
    : "—";
};

const getItemPrice = (item) => Number(item.purchasedUnitPrice ?? item.price ?? item.unitPrice ?? 0);

const getAddressLines = (address = {}) => [
  address.street || address.address,
  address.landmark,
  address.ncmCoveredArea,
  [address.city, address.district, address.province].filter(Boolean).join(", "),
  address.postalCode || address.zipCode,
].filter(Boolean);

const getOrderName = (order) =>
  order?.name ||
  `${order?.firstName || ""} ${order?.lastName || ""}`.trim() ||
  "Customer";

const DistributorCourierSlip = ({ orders, onClose }) => {
  const { distributor, manufacturer, companyContact } = useManufacturer();
  const sender = distributor || manufacturer || {};
  const senderName = sender.name || sender.businessName || "Distributor";
  const senderContactName = sender.pickupContactName || sender.name || sender.businessName || "Distributor";
  const senderPhone = sender.pickupContactPhone || sender.phone;
  const senderAddress = sender.pickupAddress || sender.street || sender.address;

  if (!orders?.length) return null;

  return (
    <div className="courier-slip-overlay">
      <section className="courier-slip-dialog" role="dialog" aria-modal="true" aria-labelledby="courier-slip-title">
        <header className="courier-slip-controls">
          <div>
            <h2 id="courier-slip-title">Print parcel slips</h2>
            <p>{orders.length} compact 80 mm slip{orders.length === 1 ? "" : "s"} · place each outside its package</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close print preview">
            <X size={18} />
          </button>
        </header>

        <div className="courier-slip-preview-list">
          {orders.map((record) => {
            const order = record.order || record;
            const address = order.address || {};
            const items = Array.isArray(order.items) ? order.items : [];
            const itemsTotal = items.reduce((sum, item) => sum + getItemPrice(item) * Number(item.quantity || 1), 0);
            const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
            const orderTotal = Number(order.amount || 0);
            const isPaid = Boolean(order.payment);
            const orderId = record.orderId || order.id || order._id || "";
            const shortId = String(orderId).slice(-8).toUpperCase();
            const gift = order.assignedGift?.name || order.rewardApplied?.giftDescription || order.giftDescription;
            const orderDate = order.date ? new Date(Number(order.date)).toLocaleDateString("en-NP") : "";
            const deliveryMode = record.delivery?.ncmOrderId || record.deliveryType === "NCM"
              ? "NCM COURIER"
              : "SELF DELIVERY";
            const addressLines = getAddressLines(address);

            return (
              <article className="courier-slip" key={record.assignmentId || orderId}>
                <div className="courier-slip-brand">
                  <strong>AAMA CLOTHINGS</strong>
                  <span>PARCEL SLIP · PLACE OUTSIDE PACKAGE</span>
                </div>

                <div className="courier-slip-order">
                  <strong>ORDER #{shortId}</strong>
                  <span>{deliveryMode}</span>
                </div>
                {orderDate && <div className="courier-slip-ref">Order date: {orderDate}</div>}
                {record.delivery?.ncmOrderId && (
                  <div className="courier-slip-ref">NCM reference: {record.delivery.ncmOrderId}</div>
                )}

                <div className="courier-slip-section">
                  <strong>TO</strong>
                  <b>{getOrderName(address)}</b>
                  {addressLines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
                  {address.phone && <span>Phone: {address.phone}</span>}
                  {address.phone2 && <span>Alt: {address.phone2}</span>}
                </div>

                <div className="courier-slip-items">
                  <div className="courier-slip-item courier-slip-item-header">
                    <strong>ITEM / VARIANT</strong>
                    <strong>QTY</strong>
                    <strong>TOTAL</strong>
                  </div>
                  {items.map((item, index) => {
                    const quantity = Number(item.quantity || 1);
                    const unitPrice = getItemPrice(item);
                    const variant = [item.size, item.color].filter(Boolean).join(" / ");
                    return (
                      <div className="courier-slip-item" key={`${item.productId || item.name || "item"}-${index}`}>
                        <span>
                          <b>{item.name || "Product"}{item.isGift ? " · GIFT" : ""}</b>
                          {variant && <small>{variant}</small>}
                          <small>{formatMoney(unitPrice)} each</small>
                          {Number(item.originalUnitPrice) > unitPrice && (
                            <small>Was {formatMoney(item.originalUnitPrice)}</small>
                          )}
                          {(item.offerTag || item.offerTitle) && <small>{item.offerTag || item.offerTitle}</small>}
                        </span>
                        <span>{quantity}</span>
                        <b>{formatMoney(unitPrice * quantity)}</b>
                      </div>
                    );
                  })}
                  {gift && (
                    <div className="courier-slip-gift">
                      <b>COMPLIMENTARY GIFT</b>
                      <span>{gift} ×1{order.assignedGift?.sku ? ` · ${order.assignedGift.sku}` : ""}</span>
                    </div>
                  )}
                </div>

                <div className="courier-slip-totals">
                  <div><span>Items ({totalQuantity} pcs)</span><b>{formatMoney(itemsTotal)}</b></div>
                  {Number(order.deliveryFee) > 0 && (
                    <div><span>Delivery fee</span><b>{formatMoney(order.deliveryFee)}</b></div>
                  )}
                  {Number(order.loyaltyDiscount || order.discountAmount) > 0 && (
                    <div><span>Discount</span><b>-{formatMoney(order.loyaltyDiscount || order.discountAmount)}</b></div>
                  )}
                  <div className="courier-slip-total"><strong>ORDER TOTAL</strong><strong>{formatMoney(orderTotal)}</strong></div>
                </div>

                <div className="courier-slip-payment">
                  <span>{isPaid ? "PAID" : String(order.paymentMethod || "COD").toUpperCase()}</span>
                  <strong>{isPaid ? "NO PAYMENT DUE" : `COLLECT ${formatMoney(orderTotal)}`}</strong>
                </div>

                <div className="courier-slip-sender">
                  <strong>FROM</strong>
                  <b>Distributor: {senderName}</b>
                  <span>Contact: {senderContactName}{senderPhone ? ` · ${senderPhone}` : ""}</span>
                  {[senderAddress, sender.city].filter(Boolean).length > 0 && (
                    <span>{[senderAddress, sender.city].filter(Boolean).join(" · ")}</span>
                  )}
                  <b>Company: Aama Clothings</b>
                  {(companyContact?.email || companyContact?.phone) && (
                    <span>Contact: {[companyContact.email, companyContact.phone].filter(Boolean).join(" · ")}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="courier-slip-controls courier-slip-actions">
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" className="courier-slip-print-button" onClick={() => window.print()}>
            <Printer size={15} /> Print {orders.length} slip{orders.length === 1 ? "" : "s"}
          </button>
        </div>
      </section>
    </div>
  );
};

export default DistributorCourierSlip;
