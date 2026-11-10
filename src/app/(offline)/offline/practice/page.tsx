import { Suspense } from "react";
import { OfflinePractice } from "@/components/offline/offline-practice";

export default function OfflinePracticePage() {
  return (
    <Suspense fallback={null}>
      <OfflinePractice />
    </Suspense>
  );
}
