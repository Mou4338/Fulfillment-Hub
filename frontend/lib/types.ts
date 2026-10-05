
export type RiskState = "on_track" | "at_risk" | "delayed" | "done";

export interface Risk {
  state: RiskState;
  label: string;
  minutes_left: number | null;
  reason: string | null;
}

export interface OrderSummary {
  id: string;
  channel: string;
  channel_ref: string;
  customer_name: string;
  city: string;
  priority: boolean;
  status: string;
  status_label: string;
  stage: string | null;
  received_at: string;
  ship_by: string;
  after_cutoff: boolean;
  courier_id: string | null;
  courier_name: string | null;
  items: number;
  units: number;
  open_issues: number;
  blocked: boolean;
  blocked_short: string | null;
  risk: Risk;
  order_value: number;
  shipped_at: string | null;
  scan_error: boolean;
  picked_lines?: number;
  total_lines?: number;
  first_bin?: string | null;
}

export interface LineItem {
  id: number;
  sku: string;
  name: string;
  variant: string;
  qty: number;
  bin: string | null;
  reserved_qty: number;
  picked_qty: number;
  verified_qty: number;
  pick_status: "pending" | "picked" | "not_found" | "damaged";
  price: number;
  main_available: number;
  secondary_available: number;
}

export interface Cta {
  kind: string;
  label: string;
  href?: string;
  sku?: string;
  qty?: number;
  transfer_id?: string;
  issue_id?: string;
  office_only?: boolean;
}

export interface ActivityRow {
  id?: number;
  at: string;
  actor: string;
  role: string;
  action: string;
  message: string;
  order_id?: string | null;
  package_id?: string | null;
  issue_id?: string | null;
}

export interface Issue {
  id: string;
  type: string;
  severity: "Low" | "Medium" | "High" | "Critical";
  status: "Open" | "In Progress" | "Resolved";
  title: string;
  description: string;
  order_id: string | null;
  package_id: string | null;
  product_id: number | null;
  item_id: number | null;
  sku: string | null;
  product_name: string | null;
  blocking: boolean;
  assignee: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution: string | null;
  actions: { key: string; label: string; office_only: boolean }[];
  timeline?: ActivityRow[];
}

export interface Package {
  id: string;
  order_id: string;
  package_type: string;
  dims: string;
  weight_kg: number;
  courier_id: string;
  label_code: string;
  staging_location: string | null;
  status: string;
  pickup_at: string | null;
  packed_at: string;
  staged_at: string | null;
  handed_over_at: string | null;
  manifest_id: string | null;
}

export interface CourierOption {
  id: string;
  name: string;
  next_pickup: string;
  next_pickup_label: string;
  cost: number;
  delivery: string;
  meets_ship_by: boolean;
}

export interface OrderDetail extends OrderSummary {
  phone: string;
  address: string;
  pincode: string;
  courier: { id: string; name: string; lane: string; reason: string; cost: number; delivery: string } | null;
  label_code: string | null;
  hold_reason: string | null;
  cancel_reason: string | null;
  last_scan_error: string | null;
  scan_failures: number;
  timestamps: Record<string, string | null>;
  line_items: LineItem[];
  package: Package | null;
  blocked_info: { blocked: boolean; kind: string | null; reasons: string[] };
  next_action: { text: string; cta: Cta | null };
  issues: Issue[];
  timeline: ActivityRow[];
  courier_options: CourierOption[];
  suggested_package_type?: string;
  expected_weight_by_type?: Record<string, number>;
}

export interface Meta {
  now: string;
  timezone: string;
  couriers: { id: string; name: string; pickups: string[]; cost: number; delivery: string; lane: string }[];
  warehouses: { id: string; name: string; kind: string; can_ship: number }[];
  channels: string[];
  package_types: Record<string, { tare_kg: number; dims: string }>;
  staging_locations: string[];
  issue_types: string[];
  severities: string[];
  statuses: Record<string, string>;
  stages: { key: string; label: string }[];
  thresholds: Record<string, any>;
  demo_order_id: string | null;
  seeded_at: string | null;
}

export interface WarehouseStock {
  bin: string | null;
  on_hand: number;
  reserved: number;
  available: number;
  awaiting_putaway: number;
  capacity: number;
  fill_pct: number;
  available_pct: number;
}

export type ReplenishStatus = "ok" | "transfer_required" | "in_transfer" | "putaway" | "incoming" | "reorder" | "wait";

export interface ReplenishInfo {
  status: ReplenishStatus;
  level: "ok" | "warning" | "critical";
  label: string;
  message: string;
  below_line: boolean;
  line_units: number;
  available_pct: number;
  suggested_qty: number;
  room: number;
}

export interface InventoryRow {
  product_id: number;
  sku: string;
  name: string;
  variant: string;
  category: string;
  low_stock_threshold: number;
  main: WarehouseStock;
  secondary: WarehouseStock;
  sellable: number;
  low_stock: boolean;
  blocking: boolean;
  transfer_required: boolean;
  has_open_issue: boolean;
  shortage: any;
  open_transfer: any;
  on_order: number;
  incoming_delivery: { id: string; expected_at: string; expected_qty: number; warehouse_id: string; reorder_id: string | null } | null;
  replenish: ReplenishInfo;
}

export interface ReplenishItem extends ReplenishInfo {
  product_id: number;
  sku: string;
  name: string;
  variant: string;
  bin: string | null;
  secondary_bin: string | null;
  capacity: number;
  on_hand: number;
  reserved: number;
  available: number;
  secondary_available: number;
  blocking_orders: number;
  open_transfer: any;
}

export interface Replenishment {
  rule: { below_pct: number; critical_pct: number };
  count: number;
  transfer_required: number;
  units_to_move: number;
  items: ReplenishItem[];
}

export interface BinCell {
  bin: string;
  sku: string;
  name: string;
  variant: string;
  category: string;
  on_hand: number;
  reserved: number;
  available: number;
  awaiting_putaway: number;
  capacity: number;
  fill_pct: number;
  available_pct: number;
  status: "ok" | "warning" | "critical" | "blocking" | "empty";
  replenish: ReplenishInfo | null;
  has_open_issue: boolean;
}

export interface BinMap {
  warehouse_id: "MAIN" | "SEC";
  rule: { below_pct: number; critical_pct: number };
  totals: { bins: number; units_on_hand: number; units_available: number; capacity: number; below_line: number; empty: number };
  aisles: { aisle: string; bins: BinCell[]; units: number; attention: number }[];
}

export interface QueueOrder extends OrderSummary {
  position: number;
  lines: { sku: string; variant: string; qty: number }[];
  preview: { kind: "ready" | "needs_stock" | "hold"; label: string; text: string };
  courier_preview: { id: string; name: string; reason: string } | null;
  waiting_minutes: number;
}

export interface ProcessingBoard {
  now: string;
  rule: string;
  queue: QueueOrder[];
  on_hold: (OrderSummary & { hold_reasons: string[] })[];
  waiting_stock: (OrderSummary & { short: { sku: string; qty: number; fix: string; transfer_id: string | null }[] })[];
  recent: { id: string; customer_name: string; priority: boolean; status: string; status_label: string; processed_at: string; courier_name: string | null }[];
  stats: Record<string, any>;
  batch_max: number;
}

export type DeliveryStatus = "expected" | "received" | "putaway_done" | "cancelled";
export type DeliverySource = "supplier" | "reorder" | "backorder" | "manual";

export interface DeliveryLine {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  variant: string;
  expected_qty: number;
  received_qty: number | null;
  damaged_qty: number;
  putaway_qty: number;
  good_qty: number;
  awaiting_putaway: number;
  missing_qty: number;
  extra_qty: number;
  missing_action: "close" | "backorder" | null;
  reorder_line_id: number | null;
  bin: string | null;
}

export interface Delivery {
  id: string;
  supplier: string;
  warehouse_id: "MAIN" | "SEC";
  expected_at: string;
  status: DeliveryStatus;
  received_at: string | null;
  received_by: string | null;
  source: DeliverySource;
  source_label: string;
  reorder_id: string | null;
  note: string | null;
  overdue: boolean;
  totals: { expected: number; received: number; good: number; damaged: number; missing: number; awaiting_putaway: number; putaway: number };
  lines: DeliveryLine[];
}

export type ReorderStatus = "ordered" | "partly_received" | "received" | "closed_short" | "cancelled";

export interface ReorderLine {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  variant: string;
  ordered: number;
  arrived_ok: number;
  damaged: number;
  not_coming: number;
  still_due: number;
  put_away: number;
  awaiting_putaway: number;
  outcome: "due" | "complete" | "short";
}

export interface Reorder {
  id: string;
  supplier: string;
  warehouse_id: "MAIN" | "SEC";
  warehouse_label: string;
  status: ReorderStatus;
  status_label: string;
  created_at: string;
  created_by: string;
  expected_at: string;
  note: string | null;
  closed_at: string | null;
  closed_by: string | null;
  close_reason: string | null;
  lines: ReorderLine[];
  totals: { ordered: number; arrived_ok: number; damaged: number; not_coming: number; still_due: number; put_away: number; awaiting_putaway: number };
  progress_pct: number;
  deliveries: { id: string; status: DeliveryStatus; expected_at: string; received_at: string | null; received_by: string | null; source: DeliverySource; overdue: boolean }[];
  next_due_at: string | null;
  overdue: boolean;
  can_cancel: boolean;
  can_close: boolean;
  can_edit_date: boolean;
}

export interface ReorderList {
  counts: { open: number; overdue: number; units_due: number; to_put_away: number; done: number };
  items: Reorder[];
}

export interface ReorderSuggestion {
  product_id: number;
  sku: string;
  name: string;
  variant: string;
  category: string;
  supplier: string;
  main_bin: string | null;
  main_capacity: number;
  main_available: number;
  secondary_available: number;
  awaiting_putaway: number;
  on_order: number;
  waiting_orders: number;
  waiting_units: number;
  position: number;
  reorder_point: number;
  target: number;
  suggested_qty: number;
  level: "critical" | "warning";
  why: string;
}

export interface ReorderSuggestions {
  rule: { below_pct: number; round_to: number; lead_days: number };
  count: number;
  critical: number;
  units: number;
  items: ReorderSuggestion[];
}

export type AreaKind = "lane" | "priority" | "overflow" | "hold" | "other";
export type HandoverMode = "manual" | "on_arrival" | "scheduled";
export type HandoverTrigger = HandoverMode;

export interface DispatchPkg extends Package {
  priority: boolean;
  customer_name: string;
  ship_by: string;
  city: string;
  order_status: string;
  courier_name: string;
  courier_lane: string;
  waiting_minutes: number;
  missed_pickup: boolean;
  suggestion?: { location: string; reason: string };
  not_ready?: string | null;
  wrong_lane?: boolean;
  reason?: string | null;
}

export interface StagingArea {
  name: string;
  kind: AreaKind;
  capacity: number;
  purpose: string;
  courier_id: string | null;
  courier_name: string | null;
  count: number;
  fill_pct: number;
  packages: DispatchPkg[];
  couriers: string[];
  priority: number;
}

export interface PullItem {
  issue_id: string;
  package_id: string;
  staging_location: string;
  order_id: string;
}

export interface StagingBoard {
  to_stage: DispatchPkg[];
  areas: StagingArea[];
  couriers: { id: string; name: string; lane: string; next_pickup: string; minutes_to_pickup: number; to_stage: number }[];
  pull_from_staging: PullItem[];
  counts: { to_stage: number; staged: number; on_hold: number; wrong_lane: number; areas_full: number };
  alert_minutes: number;
}

export interface CourierVisit {
  id: string;
  courier_id: string;
  courier_name?: string;
  arrived_at: string;
  recorded_by: string;
  trigger: HandoverTrigger;
  manifest_id: string | null;
  parcels: number;
  left_behind: number;
  note: string | null;
}

export interface HandoverGroup {
  courier: { id: string; name: string; lane: string; pickups: string[]; cost: number; delivery: string };
  mode: HandoverMode;
  mode_label: string;
  next_pickup: string;
  minutes_to_pickup: number;
  ready: DispatchPkg[];
  not_ready: DispatchPkg[];
  unstaged: number;
  alert: boolean;
  on_site: boolean;
  last_visit: CourierVisit | null;
  shipped_today: number;
  locations: string[];
}

export interface HandoverBoard {
  couriers: HandoverGroup[];
  modes: { id: HandoverMode; label: string }[];
  counts: { ready: number; not_ready: number; on_site: number };
  pull_from_staging: PullItem[];
  on_site_minutes: number;
}

export interface ManifestRow {
  id: string;
  courier_id: string;
  courier_name: string;
  created_at: string;
  created_by: string;
  parcel_count: number;
  trigger: HandoverTrigger;
}

export interface Manifest extends ManifestRow {
  trigger_label: string;
  parcels: { id: string; order_id: string; package_type: string; weight_kg: number; handed_over_at: string; staging_location: string | null; customer_name: string; city: string; pincode: string; priority: number }[];
}

export interface ShippedParcel {
  id: string;
  order_id: string;
  package_type: string;
  weight_kg: number;
  courier_id: string;
  courier_name: string;
  label_code: string;
  handed_over_at: string;
  manifest_id: string | null;
  staging_location: string | null;
  customer_name: string;
  city: string;
  pincode: string;
  priority: boolean;
  ship_by: string;
  channel: string;
  handed_by: string | null;
  trigger: HandoverTrigger | null;
  on_time: boolean;
}

export interface ShippedData {
  range: string;
  stats: { parcels: number; manifests: number; automatic: number; on_time_pct: number | null; priority: number; by_courier: { courier: string; parcels: number }[] };
  parcels: ShippedParcel[];
  manifests: ManifestRow[];
  visits: CourierVisit[];
  couriers: { id: string; name: string }[];
}

export type ActivityCategory = "orders" | "picking" | "packing" | "dispatch" | "stock" | "receiving" | "issues" | "team";

export interface ActivityRecord {
  id: number;
  at: string;
  actor: string;
  role: string;
  action: string;
  label: string;
  category: ActivityCategory;
  message: string;
  order_id: string | null;
  package_id: string | null;
  issue_id: string | null;
  product_id: number | null;
}

export interface ActivityRecords {
  items: ActivityRecord[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  categories: { key: ActivityCategory; label: string; count: number }[];
}

export interface ActivityPerson {
  actor: string;
  role: string;
  total: number;
  today: number;
  last_at: string;
  last: { action: string; label: string; category: ActivityCategory; message: string; at: string } | null;
  top_category: ActivityCategory | null;
  by_category: Partial<Record<ActivityCategory, number>>;
}
