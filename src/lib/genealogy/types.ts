export type GenealogyPriority = 'critical' | 'high' | 'normal';
export type CrawlJobStatus = 'proposed' | 'approved' | 'queued' | 'awaiting_browser' | 'running' | 'discovering' | 'discovered' | 'downloading' | 'downloaded' | 'scanning' | 'catalogued' | 'complete' | 'blocked' | 'failed';

export interface ResearchFrontier {
  id: string;
  branch: 'Power' | 'Durocher' | 'Theoret' | 'Charette' | 'Baril/Barry';
  person: string;
  objective: string;
  place: string;
  yearFrom?: number;
  yearTo?: number;
  variants: string[];
  priority: GenealogyPriority;
  rationale: string;
}

export interface CrawlJob {
  id: number;
  frontier_id: string | null;
  archive: string;
  source_url: string;
  register_id: string | null;
  page_hint: number | null;
  status: CrawlJobStatus;
  objective: string;
  target_names: string[];
  year_from: number | null;
  year_to: number | null;
  pages_discovered: number;
  pages_downloaded: number;
  pages_scanned: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CatalogueSummary {
  pages: number;
  enhanced: number;
  scan_runs: number;
  indexed_pages: number;
  observations: number;
  needs_review: number;
}

export interface CataloguePage {
  id: number;
  job_id: number;
  page_number: number | null;
  source_url: string;
  sha256: string | null;
  width: number | null;
  height: number | null;
  status: string;
  archive_label?: string | null;
  index_status?: string;
  index_year_from?: number | null;
  index_year_to?: number | null;
  index_names?: string[];
  index_terms?: string[];
  index_confidence?: number | null;
  variant_count: number;
  scan_count: number;
  observation_count: number;
  created_at: string;
}
