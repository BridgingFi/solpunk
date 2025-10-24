import { Route, Routes } from "react-router-dom";

import { SolanaProvider } from "@/components/solana-provider";
import IndexPage from "@/pages/index";

function App() {
  return (
    <SolanaProvider>
      <Routes>
        <Route element={<IndexPage />} path="/" />
      </Routes>
    </SolanaProvider>
  );
}

export default App;
