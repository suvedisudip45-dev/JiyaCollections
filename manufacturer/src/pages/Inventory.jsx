import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Boxes,
  Search,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  Edit2,
  X,
  Package,
  DollarSign,
  Tag,
  Layers,
  HelpCircle,
  Check,
  AlertCircle,
} from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";
import Pagination from "../components/Pagination";

const Inventory = () => {
  const { token, backendUrl, currency } = useManufacturer();
  const [inventory, setInventory] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  // Modal editing state
  const [variantsState, setVariantsState] = useState([]);
  const [proposedCost, setProposedCost] = useState("");
  const [quoteNote, setQuoteNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchInventory = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`${backendUrl}/api/manufacturer-inventory/my?page=${page}&limit=10`, {
        headers: { token },
      });
      if (res.data.success) {
        setInventory(res.data.inventory || []);
        setPagination(res.data.pagination || null);
      }
    } catch (err) {
      toast.error("Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [token, backendUrl, page]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const handlePageChange = (nextPage) => setPage(nextPage);

  const openEditModal = (item) => {
    setSelectedItem(item);
    // Clone variants array with quantity
    const variants = (item.variantsStock || []).map((v) => ({
      size: v.size || "Standard",
      color: v.color || "Standard",
      quantity: Number(v.quantity || 0),
      reservedQty: Number(v.reservedQty || 0),
    }));
    setVariantsState(variants);
    setProposedCost(
      item.proposedCostPrice !== null && item.proposedCostPrice !== undefined
        ? item.proposedCostPrice
        : item.agreedCostPrice !== null && item.agreedCostPrice !== undefined
        ? item.agreedCostPrice
        : ""
    );
    setQuoteNote(item.priceNote || "");
    setEditModalOpen(true);
  };

  const handleVariantQtyChange = (index, value) => {
    const updated = [...variantsState];
    const qty = Math.max(0, parseInt(value, 10) || 0);
    updated[index].quantity = qty;
    setVariantsState(updated);
  };

  const handleUpdateStockAndPricing = async (e) => {
    e.preventDefault();
    if (!selectedItem) return;

    // Validate proposed cost if provided
    let costVal = null;
    if (proposedCost !== "" && proposedCost !== null && proposedCost !== undefined) {
      costVal = parseFloat(proposedCost);
      if (isNaN(costVal) || costVal < 0) {
        toast.error("Please enter a valid supply cost price.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/manufacturer-inventory/update`,
        {
          productId: selectedItem.productId,
          variantsStock: variantsState,
          proposedCostPrice: costVal,
          priceNote: quoteNote,
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(res.data.message || "Stock & Price quotation saved!");
        setEditModalOpen(false);
        fetchInventory();
      } else {
        toast.error(res.data.message || "Failed to update stock");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update stock");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredItems = inventory.filter((item) => {
    const available = item.quantity - (item.reservedQty || 0);

    if (filterType === "low" && available > (item.lowStockThreshold || 5)) return false;
    if (filterType === "out" && available > 0) return false;
    if (filterType === "instock" && available <= 0) return false;
    if (filterType === "pending_price" && item.priceStatus !== "PENDING") return false;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const name = (item.product?.name || "").toLowerCase();
      const cat = (item.product?.category || "").toLowerCase();
      return name.includes(term) || cat.includes(term);
    }
    return true;
  });

  const totalProducts = inventory.length;
  const totalPhysicalStock = inventory.reduce((sum, i) => sum + (i.quantity || 0), 0);
  const totalReserved = inventory.reduce((sum, i) => sum + (i.reservedQty || 0), 0);
  const pendingPriceCount = inventory.filter((i) => i.priceStatus === "PENDING" && i.proposedCostPrice).length;

  const totalCalculatedModalQty = variantsState.reduce((sum, v) => sum + (v.quantity || 0), 0);
  const totalCalculatedModalReserved = variantsState.reduce((sum, v) => sum + (v.reservedQty || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <Boxes className="w-6 h-6 text-emerald-600" />
            Hub Inventory &amp; Supply Price Quotations
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Maintain your physical variant stock (sizes &amp; colors pre-configured by admin) and quote your supply manufacturing cost.
          </p>
        </div>

        <button
          onClick={fetchInventory}
          className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Stock
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total Catalog SKUs
          </span>
          <p className="text-2xl font-black text-slate-900 mt-1">{totalProducts}</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total Physical Units
          </span>
          <p className="text-2xl font-black text-slate-900 mt-1">
            {totalPhysicalStock} <span className="text-xs font-normal text-slate-500">units</span>
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Reserved For Orders
          </span>
          <p className="text-2xl font-black text-amber-600 mt-1">
            {totalReserved} <span className="text-xs font-normal text-slate-500">units</span>
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Pending Price Quotes
          </span>
          <p className="text-2xl font-black text-indigo-600 mt-1">
            {pendingPriceCount} <span className="text-xs font-normal text-slate-500">Awaiting Admin</span>
          </p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search garment or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {[
            { id: "all", label: "All Items" },
            { id: "instock", label: "In Stock" },
            { id: "low", label: "Low Stock Alert" },
            { id: "out", label: "Out of Stock" },
            { id: "pending_price", label: "Pending Price Review" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                filterType === tab.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading stock and pricing agreements...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Boxes className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600 text-sm">No items match your filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-3 px-4">Garment / SKU</th>
                  <th className="py-3 px-4">Size &amp; Color Variants</th>
                  <th className="py-3 px-4 text-center">Physical Total</th>
                  <th className="py-3 px-4 text-center">Available Stock</th>
                  <th className="py-3 px-4">Supply Cost Agreement</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredItems.map((item) => {
                  const product = item.product;
                  const available = (item.quantity || 0) - (item.reservedQty || 0);
                  const isLow = available <= (item.lowStockThreshold || 5);
                  const isOut = available <= 0;
                  const variants = item.variantsStock || [];

                  return (
                    <tr key={item.id || item.productId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 align-top">
                        <div className="flex items-center gap-3">
                          {product?.image ? (
                            <img
                              src={Array.isArray(product.image) ? product.image[0] : product.image}
                              alt={product?.name}
                              className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
                              <Package className="w-6 h-6" />
                            </div>
                          )}
                          <div>
                            <span className="font-bold text-slate-900 block text-sm">{product?.name}</span>
                            <span className="text-[10px] text-slate-400">
                              Cat: {product?.category || "Apparel"} • Retail: {currency}{product?.price}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Variants Summary Badge Grid */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="flex flex-wrap gap-1.5 max-w-xs">
                          {variants.length > 0 ? (
                            variants.map((v, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] text-slate-700 font-medium"
                              >
                                <span className="font-bold text-slate-900">{v.size}</span>
                                {v.color && v.color !== "Standard" && (
                                  <span className="text-slate-500">/ {v.color}</span>
                                )}
                                <span className="text-emerald-700 font-black ml-1">
                                  {v.quantity || 0}
                                </span>
                              </span>
                            ))
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">No variants defined</span>
                          )}
                        </div>
                      </td>

                      {/* Physical Total */}
                      <td className="py-3.5 px-4 text-center font-bold text-slate-800 align-top">
                        <span className="text-sm">{item.quantity || 0}</span>
                        {item.reservedQty > 0 && (
                          <span className="block text-[10px] text-amber-600 font-normal">
                            ({item.reservedQty} reserved)
                          </span>
                        )}
                      </td>

                      {/* Available Status */}
                      <td className="py-3.5 px-4 text-center align-top">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-xs ${
                            isOut
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : isLow
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          }`}
                        >
                          {available} units
                          {isLow && !isOut && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                        </span>
                      </td>

                      {/* Price Agreement Status */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1">
                          {item.agreedCostPrice ? (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle className="w-3 h-3" />
                                Agreed: {currency}{item.agreedCostPrice}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">No price agreed yet</span>
                          )}

                          {item.priceStatus === "PENDING" && item.proposedCostPrice && (
                            <div className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              <Clock className="w-3 h-3 text-amber-500 shrink-0" />
                              <span>Quote pending review: {currency}{item.proposedCostPrice}</span>
                            </div>
                          )}

                          {item.priceStatus === "REJECTED" && (
                            <div className="flex items-center gap-1 text-[10px] text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                              <AlertCircle className="w-3 h-3 text-rose-500 shrink-0" />
                              <span>Admin requested revision</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right align-top">
                        <button
                          onClick={() => openEditModal(item)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer shadow-xs transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          Update Stock &amp; Price
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={pagination?.page || page}
          totalPages={pagination?.totalPages || 0}
          total={pagination?.total || 0}
          onPageChange={handlePageChange}
          loading={loading}
        />
      </div>

      {/* Update Stock & Price Quotation Modal */}
      {editModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Update Variant Stock &amp; Supply Quotation
                </h3>
                <p className="text-xs text-slate-500">
                  Enter physical units for admin-configured varieties and submit your manufacturing cost price.
                </p>
              </div>
              <button
                onClick={() => setEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Product Summary */}
            <div className="p-3.5 bg-slate-50 rounded-2xl flex items-center gap-3 border border-slate-100">
              {selectedItem.product?.image ? (
                <img
                  src={
                    Array.isArray(selectedItem.product.image)
                      ? selectedItem.product.image[0]
                      : selectedItem.product.image
                  }
                  alt={selectedItem.product?.name}
                  className="w-12 h-12 rounded-xl object-cover border border-slate-200"
                />
              ) : (
                <Package className="w-8 h-8 text-emerald-600" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">
                  {selectedItem.product?.name}
                </p>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                  <span>Store Retail Price: <strong className="text-slate-800">{currency}{selectedItem.product?.price}</strong></span>
                  <span>Currently Reserved: <strong className="text-amber-600">{selectedItem.reservedQty || 0} pcs</strong></span>
                </div>
              </div>
            </div>

            <form onSubmit={handleUpdateStockAndPricing} className="space-y-5">
              {/* Variant Stock Inputs Grid */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-600" />
                    Physical Stock by Variant (Admin-Defined)
                  </label>
                  <span className="text-xs font-bold text-slate-600">
                    Total: <span className="text-emerald-600 font-black">{totalCalculatedModalQty}</span> units
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  You can update physical quantities for the sizes &amp; colors created by the admin.
                </p>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2 max-h-48 overflow-y-auto">
                  {variantsState.map((v, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between gap-3 p-2 bg-white rounded-xl border border-slate-200/80 shadow-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 bg-slate-900 text-white text-xs font-bold rounded-lg">
                          {v.size}
                        </span>
                        {v.color && v.color !== "Standard" && (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200">
                            {v.color}
                          </span>
                        )}
                        {v.reservedQty > 0 && (
                          <span className="text-[10px] text-amber-600 font-semibold">
                            ({v.reservedQty} reserved)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-slate-400 font-medium">Qty:</label>
                        <input
                          type="number"
                          min={v.reservedQty || 0}
                          value={v.quantity}
                          onChange={(e) => handleVariantQtyChange(index, e.target.value)}
                          className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-900 font-bold text-center focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Price Agreement & Quotation Section */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                    Mutual Price Agreement &amp; Cost Quote
                  </label>
                  {selectedItem.agreedCostPrice && (
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      Active Cost: {currency}{selectedItem.agreedCostPrice}
                    </span>
                  )}
                </div>

                {selectedItem.adminFeedback && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                    <strong className="block font-bold">Admin Feedback on previous quote:</strong>
                    {selectedItem.adminFeedback}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Your Quoted Supply / Unit Cost ({currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 450.00"
                    value={proposedCost}
                    onChange={(e) => setProposedCost(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 font-bold focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Updating this cost will send a quote request to the Admin for mutual agreement. Admin will review and accept before profit margins take effect.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Quotation Note / Specification Breakdown (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Premium 220 GSM combed cotton fabric with bio-wash"
                    value={quoteNote}
                    onChange={(e) => setQuoteNote(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {submitting ? "Saving & Quoting..." : "Save Stock & Submit Quotation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;
