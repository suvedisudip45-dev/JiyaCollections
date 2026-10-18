/* eslint-disable no-unused-vars */
import React, { useContext } from "react";
import { ShopContext } from "../context/ShopContext";
import Title from "./Title";

/**
 * CartTotal - reusable cart summary.
 * @param {number} [deliveryFee]      – override shipping fee (e.g. from PlaceOrder dynamic calc)
 * @param {string} [shippingLabel]    – human-readable label (e.g. "Inside Kathmandu")
 * @param {number} [loyaltyDiscount]  – active loyalty tier price discount
 * @param {string} [loyaltyLabel]     – badge/description for the loyalty reward
 * @param {object} [loyaltyGift]      – { amount, description, letterIncluded, customPerk }
 * @param {number} [cardDiscount]     – selected marketing card discount
 * @param {string} [cardRewardLabel]  – selected marketing card reward name
 * @param {boolean} [isCartPage]      – true when viewed from /cart before address selection
 * @param {boolean} [requireQuotedFee] – prevent fallback shipping fees until checkout has a valid quote
 */
const CartTotal = ({
  deliveryFee,
  shippingLabel,
  loyaltyDiscount = 0,
  loyaltyLabel,
  loyaltyGift,
  // eslint-disable-next-line react/prop-types
  cardDiscount = 0,
  // eslint-disable-next-line react/prop-types
  cardRewardLabel,
  subtotalOverride,
  isCartPage = false,
  // eslint-disable-next-line react/prop-types
  requireQuotedFee = false,
}) => {
  const { currency, delivery_fee, getCartAmount, shippingConfig } = useContext(ShopContext);

  const subtotal = subtotalOverride !== undefined ? Number(subtotalOverride) : getCartAmount();
  const freeMin = Number(shippingConfig?.freeShippingMin || 0);
  const isEligibleFreeShipping = freeMin > 0 && subtotal >= freeMin;

  // On cart page, we don't assume a static 50 unless free shipping is already guaranteed
  const resolvedFee = requireQuotedFee
    ? deliveryFee
    : isCartPage
    ? isEligibleFreeShipping || deliveryFee === 0
      ? 0
      : undefined
    : deliveryFee !== undefined
    ? deliveryFee
    : delivery_fee;

  const numericShipping = resolvedFee !== undefined ? resolvedFee : 0;
  const grandTotal = Math.max(0, subtotal === 0 ? 0 : subtotal + numericShipping - loyaltyDiscount - cardDiscount);

  return (
    <div className="w-full rounded-sm border border-[var(--line)] bg-white p-5 sm:p-6">
      <div className="text-2xl">
        <Title text1={"CART"} text2={"TOTALS"} />
      </div>
      <div className="flex flex-col gap-2 mt-2 text-sm">

        {/* Subtotal */}
        <div className="flex justify-between">
          <p>Subtotal</p>
          <p className="tabular-nums">{currency} {Number(subtotal).toLocaleString()}.00</p>
        </div>
        <hr />

        {/* VIP Price Discount */}
        {loyaltyDiscount > 0 && (
          <>
            <div className="flex items-start justify-between font-semibold text-status-success-text">
              <div>
                <p>VIP Level Discount</p>
                {loyaltyLabel && (
                  <p className="text-[11px] font-normal text-status-success-text/80">{loyaltyLabel}</p>
                )}
              </div>
              <p className="tabular-nums">- {currency} {Number(loyaltyDiscount).toLocaleString()}.00</p>
            </div>
            <hr />
          </>
        )}

        {cardDiscount > 0 && (
          <>
            <div className="flex items-start justify-between font-semibold text-[var(--accent)]">
              <div>
                <p>Marketing Card Discount</p>
                {cardRewardLabel && <p className="text-[11px] font-normal text-[var(--muted)]">{cardRewardLabel}</p>}
              </div>
              <p className="tabular-nums">- {currency} {Number(cardDiscount).toLocaleString()}.00</p>
            </div>
            <hr />
          </>
        )}

        {/* Gift Voucher / Special Item */}
        {loyaltyGift && (loyaltyGift.amount > 0 || loyaltyGift.description) && (
          <>
            <div className="flex justify-between items-start font-semibold text-status-info-text">
              <div>
                <p className="flex items-center gap-1">Complimentary Gift</p>
              </div>
              {loyaltyGift.amount > 0 && (
                <p>Rs. {loyaltyGift.amount} value</p>
              )}
            </div>
            <hr />
          </>
        )}

        {/* Handwritten Letter */}
        {loyaltyGift?.letterIncluded && (
          <>
            <div className="flex justify-between items-center font-semibold text-status-info-text">
              <p className="flex items-center gap-1">Handwritten Thank-You Note</p>
              <p className="text-[11px] font-semibold">Included</p>
            </div>
            <hr />
          </>
        )}

        {/* Custom VIP Perk */}
        {loyaltyGift?.customPerk && (
          <>
            <div className="flex justify-between items-center font-semibold text-status-warning-text">
              <p className="flex items-center gap-1">{loyaltyGift.customPerk}</p>
              <p className="text-[11px] font-semibold text-status-warning-text">VIP Perk</p>
            </div>
            <hr />
          </>
        )}

        {/* Shipping Fee */}
        <div className="flex items-start justify-between">
          <div>
            <p>Shipping</p>
            {shippingLabel ? (
              <p className="text-[11px] text-gray-400">{shippingLabel}</p>
            ) : requireQuotedFee && resolvedFee === undefined ? (
              <p className="text-[11px] text-gray-400">Confirming delivery charge</p>
            ) : isCartPage ? (
              <p className="text-[11px] text-gray-400">Calculated at checkout</p>
            ) : null}
          </div>
          <div>
            {resolvedFee === 0 ? (
              <span className="border border-status-success-border bg-status-success-bg px-2 py-0.5 text-xs font-semibold text-status-success-text">
                FREE
              </span>
            ) : resolvedFee !== undefined ? (
              <span className="tabular-nums">{currency} {Number(resolvedFee).toLocaleString()}.00</span>
            ) : requireQuotedFee ? (
              <span className="text-xs italic text-gray-500">Pending quote</span>
            ) : (
              <span className="text-gray-500 text-xs italic">Calculated at next step</span>
            )}
          </div>
        </div>
        <hr />

        {/* Grand Total */}
        <div className="flex justify-between text-base">
          <b>Total</b>
          <b className="tabular-nums text-gray-900">
            {currency} {Number(grandTotal).toLocaleString()}.00
            {(isCartPage || requireQuotedFee) && resolvedFee === undefined && (
              <span className="ml-1 text-xs font-normal text-gray-400">(+ delivery charge pending)</span>
            )}
          </b>
        </div>

      </div>
    </div>
  );
};

export default CartTotal;
