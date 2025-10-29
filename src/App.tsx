import { Route, Routes } from "react-router-dom";

import { SolanaProvider } from "@/components/solana-provider";
import IndexPage from "@/pages/index";
import StakePage from "@/pages/stake";

function App() {
  return (
    <SolanaProvider>
      <Routes>
        <Route element={<IndexPage />} path="/" />
        <Route element={<StakePage />} path="/stake" />
      </Routes>
    </SolanaProvider>
  );
}

export default App;
