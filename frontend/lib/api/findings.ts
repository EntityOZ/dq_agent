import apiClient from "./client";
import type { FindingList } from "@/types/api";

export async function getFindings(params: {
  version_id: string;
  module?: string;
  severity?: string;
  dimension?: string;
  limit?: number;
  offset?: number;
}): Promise<FindingList> {
  const { data } = await apiClient.get<FindingList>("/api/v1/findings", {
    params,
  });
  return data;
}
