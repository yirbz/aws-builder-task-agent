export type RunStatus = 'running' | 'completed' | 'partial' | 'failed';
export type StepStatus = 'started' | 'completed' | 'failed' | 'skipped';
export type StepName = 'authenticate' | 'visit' | 'like' | 'comment' | 'verify';
export type ErrorType = 'retryable' | 'terminal';
export type EventType =
  | 'task.started'
  | 'task.step.started'
  | 'task.step.completed'
  | 'task.step.failed'
  | 'task.completed'
  | 'task.failed';
export type ActionType = 'like' | 'comment';

export interface Run {
  run_id: string;
  scheduled_at: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status: RunStatus;
  streak_visit_before: number | null;
  streak_like_before: number | null;
  streak_comment_before: number | null;
  streak_visit_after: number | null;
  streak_like_after: number | null;
  streak_comment_after: number | null;
  error_message: string | null;
  error_stack: string | null;
}

export interface Step {
  id?: number;
  run_id: string;
  step_name: StepName;
  sequence_number: number;
  status: StepStatus;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  retry_count: number;
  error_type: ErrorType | null;
  error_message: string | null;
  result_data: string | null; // JSON string
}

export interface Interaction {
  id?: number;
  run_id: string;
  post_id: string;
  post_url: string | null;
  post_title: string | null;
  action_type: ActionType;
  comment_text: string | null;
  created_at: string;
}

export interface Event {
  id?: number;
  run_id: string;
  event_type: EventType;
  step_name: StepName | null;
  sequence_number: number;
  timestamp: string;
  duration_ms: number | null;
  payload: string | null; // JSON string
}

export interface StepResult {
  name: StepName;
  status: StepStatus;
  durationMs: number;
  retryCount: number;
  errorType?: ErrorType;
  errorMessage?: string;
  resultData?: Record<string, unknown>;
}

export interface ExecutionReport {
  runId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  steps: StepResult[];
  streaks: {
    visit: number;
    like: number;
    comment: number;
    target: number;
  };
  errorMessage?: string;
  errorStack?: string;
  screenshotPath?: string;
  screenshotBuffer?: Buffer;
}

export interface StreakCounter {
  current: number;
  target: number;
  todayCompleted: boolean;
}

export interface StreakStatus {
  streaks: {
    visit: StreakCounter;
    like: StreakCounter;
    comment: StreakCounter;
  };
  lastRun: {
    runId: string;
    timestamp: string;
    status: RunStatus;
  } | null;
  nextWindow: {
    start: string;
    end: string;
  };
  daysRemaining: number;
}

export interface ArticleContext {
  id?: string;
  url?: string;
  title: string;
  preview: string;
}

export interface ScheduleConfig {
  windowStart: string; // "HH:MM" e.g. "10:45"
  windowMinutes: number; // >= 45 e.g. 45
  timezone: string; // e.g. "America/New_York"
}

export interface BrowserConfig {
  profileDir: string;
  screenshotOnFailure: boolean;
}

export interface CommentsConfig {
  provider: 'gemini' | 'ollama' | 'fallback';
  geminiApiKey?: string;
  geminiModel?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  timeoutMs?: number;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
}

export interface DiscordConfig {
  enabled: boolean;
  webhookUrl?: string;
}

export interface NotificationsConfig {
  telegram: TelegramConfig;
  discord: DiscordConfig;
}

export interface DatabaseConfig {
  path: string;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface Config {
  schedule: ScheduleConfig;
  browser: BrowserConfig;
  comments: CommentsConfig;
  notifications: NotificationsConfig;
  database: DatabaseConfig;
  retry: RetryConfig;
}
