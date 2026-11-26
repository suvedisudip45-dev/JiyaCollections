import App from "./App.jsx";
import "./index.css";
import { BrowserRouter } from "react-router-dom";
import ReactDOM from "react-dom/client";

const routerBasename = import.meta.env.BASE_URL === "/"
  ? "/"
  : import.meta.env.BASE_URL.replace(/\/$/, "");

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter basename={routerBasename}>
    <App />
  </BrowserRouter>
);
