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
 * @param {boolean} [isCartPage]      – true when viewed from /cart before address selection
 */
const CartTotal = ({
  deliveryFee,
  shippingLabel,
  loyaltyDiscount = 0,
  loyaltyLabel,
  loyaltyGift,
  isCartPage = false,
}) => {
  const { currency, delivery_fee, getCartAmount, shippingConfig } = useContext(ShopContext);

  const subtotal = getCartAmount();
  const freeMin = Number(shippingConfig?.freeShippingMin || 0);
  const isEligibleFreeShipping = freeMin > 0 && subtotal >= freeMin;

  // On cart page, we don't assume a static 50 unless free shipping is already guaranteed
  const resolvedFee = isCartPage
    ? isEligibleFreeShipping || deliveryFee === 0
      ? 0
      : undefined
    : deliveryFee !== undefined
    ? deliveryFee
    : delivery_fee;

  const numericShipping = resolvedFee !== undefined ? resolvedFee : 0;
  const grandTotal = Math.max(0, subtotal === 0 ? 0 : subtotal + numericShipping - loyaltyDiscount);

  return (
    <div className="w-full">
      <div className="text-2xl">
        <Title text1={"CART"} text2={"TOTALS"} />
      </div>
      <div className="flex flex-col gap-2 mt-2 text-sm">

        {/* Subtotal */}
        <div className="flex justify-between">
          <p>Subtotal</p>
          <p>{currency} {subtotal}.00</p>
        </div>
        <hr />

        {/* VIP Price Discount */}
        {loyaltyDiscount > 0 && (
          <>
            <div className="flex justify-between items-start text-emerald-600 font-semibold">
              <div>
                <p>VIP Level Discount</p>
                {loyaltyLabel && (
                  <p className="text-[11px] text-emerald-500 font-normal">{loyaltyLabel}</p>
                )}
              </div>
              <p>- {currency} {loyaltyDiscount}.00</p>
            </div>
            <hr />
          </>
        )}

        {/* Gift Voucher / Special Item */}
        {loyaltyGift && (loyaltyGift.amount > 0 || loyaltyGift.description) && (
          <>
            <div className="flex justify-between items-start text-indigo-600 font-semibold">
              <div>
                <p className="flex items-center gap-1">Complimentary Gift</p>
                {loyaltyGift.description && (
                  <p className="text-[11px] text-indigo-500 font-normal">{loyaltyGift.description}</p>
                )}
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
            <div className="flex justify-between items-center text-violet-600 font-semibold">
              <p className="flex items-center gap-1">Handwritten Thank-You Note</p>
              <p className="text-[11px] font-semibold">Included</p>
            </div>
            <hr />
          </>
        )}

        {/* Custom VIP Perk */}
        {loyaltyGift?.customPerk && (
          <>
            <div className="flex justify-between items-center text-amber-700 font-semibold">
              <p className="flex items-center gap-1">{loyaltyGift.customPerk}</p>
              <p className="text-[11px] font-semibold text-amber-600">VIP Perk</p>
            </div>
            <hr />
          </>
        )}

        {/* Shipping Fee */}
        <div className="flex justify-between items-start">
          <div>
            <p>Shipping</p>
            {shippingLabel ? (
              <p className="text-[11px] text-gray-400">{shippingLabel}</p>
            ) : isCartPage ? (
              <p className="text-[11px] text-gray-400">Calculated at checkout</p>
            ) : null}
          </div>
          <div>
            {resolvedFee === 0 ? (
              <span className="text-emerald-600 font-semibold text-xs bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                FREE
              </span>
            ) : resolvedFee !== undefined ? (
              <span>{currency} {resolvedFee}.00</span>
            ) : (
              <span className="text-gray-500 text-xs italic">Calculated at next step</span>
            )}
          </div>
        </div>
        <hr />

        {/* Grand Total */}
        <div className="flex justify-between text-base">
          <b>Total</b>
          <b className="text-gray-900">
            {currency} {grandTotal}.00
            {isCartPage && resolvedFee === undefined && (
              <span className="text-xs text-gray-400 font-normal ml-1">(+ shipping)</span>
            )}
          </b>
        </div>
        {subtotal > 0 && (
          <p className="text-[11px] text-gray-500 text-right -mt-1">
            Inclusive of 13% VAT ({currency}{((subtotal / 1.13) * 0.13).toFixed(2)})
          </p>
        )}

      </div>
    </div>
  );
};

export default CartTotal;
