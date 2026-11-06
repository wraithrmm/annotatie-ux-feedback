// The full-screen capture viewer (PT-2 §4.3): its own tabs, Close top-left.

import { useEffect, useState } from "preact/hooks";
import type { Item } from "@annotatie/core";
import { CaptureTabs, type CapTab } from "./Capture";
import { Sheet } from "./Sheet";

export function CaptureViewer(props: { item: Item | null; tab: CapTab; onClose: () => void }) {
  const [tab, setTab] = useState<CapTab>(props.tab);
  useEffect(() => setTab(props.tab), [props.item, props.tab]);
  return (
    <Sheet open={!!props.item} full wide closeFirst title="Page when reported" onClose={props.onClose} testId="capture-viewer">
      {props.item && <CaptureTabs item={props.item} tab={tab} onTab={setTab} uid="vw" />}
    </Sheet>
  );
}
