import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

import Layout from '@/components/Layout';
import Overview from '@/pages/Overview';
import Contributors from '@/pages/Contributors';
import PRBottlenecks from '@/pages/PRBottlenecks';
import Bottlenecks from '@/pages/Bottlenecks';
import IssuesHealth from '@/pages/IssuesHealth';

// Register GSAP plugins
gsap.registerPlugin(ScrollTrigger, useGSAP);

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="contributors" element={<Contributors />} />
        <Route path="pr-bottlenecks" element={<PRBottlenecks />} />
        {/* <Route path="bottlenecks" element={<Bottlenecks />} />  Keeping old one just in case, but sidebar will link to new one */}
        <Route path="issues" element={<IssuesHealth />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
