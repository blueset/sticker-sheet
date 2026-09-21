import { notFound } from "next/navigation";
import SvgShapeWorkbench from "./SvgShapeWorkbench";

export default function SvgShapePage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return <SvgShapeWorkbench />;
}