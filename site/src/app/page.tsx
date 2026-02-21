import { Studio } from "@/components/Studio";
import { loadDataset } from "@/lib/load";

export default function Page() {
  return <Studio data={loadDataset()} repoUrl={process.env.NEXT_PUBLIC_REPO_URL} />;
}
