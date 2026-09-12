export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      assessment_answers: {
        Row: {
          assessment_id: string
          created_at: string
          id: string
          item_id: string | null
          note: string | null
          organization_id: string
          rating: string | null
          section_key: string | null
          updated_at: string
        }
        Insert: {
          assessment_id: string
          created_at?: string
          id?: string
          item_id?: string | null
          note?: string | null
          organization_id: string
          rating?: string | null
          section_key?: string | null
          updated_at?: string
        }
        Update: {
          assessment_id?: string
          created_at?: string
          id?: string
          item_id?: string | null
          note?: string | null
          organization_id?: string
          rating?: string | null
          section_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_answers_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_answers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "questionnaire_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_answers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          company_id: string
          conducted_on: string | null
          created_at: string
          expert_id: string
          id: string
          order_id: string | null
          organization_id: string
          questionnaire_key: string
          questionnaire_version_key: string
          site: string | null
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          conducted_on?: string | null
          created_at?: string
          expert_id: string
          id?: string
          order_id?: string | null
          organization_id: string
          questionnaire_key: string
          questionnaire_version_key: string
          site?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          conducted_on?: string | null
          created_at?: string
          expert_id?: string
          id?: string
          order_id?: string | null
          organization_id?: string
          questionnaire_key?: string
          questionnaire_version_key?: string
          site?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "assessments_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "expert_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_questionnaire_version_fkey"
            columns: ["questionnaire_key", "questionnaire_version_key"]
            isOneToOne: false
            referencedRelation: "questionnaire_versions"
            referencedColumns: ["questionnaire_key", "key"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          changed_columns: string[] | null
          id: number
          new_data: Json | null
          occurred_at: string
          old_data: Json | null
          organization_id: string | null
          row_id: string
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          changed_columns?: string[] | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          organization_id?: string | null
          row_id: string
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          changed_columns?: string[] | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          organization_id?: string | null
          row_id?: string
          table_name?: string
        }
        Relationships: []
      }
      benchmark_assumptions: {
        Row: {
          created_at: string
          effective_from: string
          is_assumption: boolean
          key: string
          label: Json
          note: Json | null
          provisional: boolean
          source_name: string
          source_url: string | null
          unit: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          effective_from: string
          is_assumption?: boolean
          key: string
          label: Json
          note?: Json | null
          provisional?: boolean
          source_name: string
          source_url?: string | null
          unit: string
          updated_at?: string
          value: number
        }
        Update: {
          created_at?: string
          effective_from?: string
          is_assumption?: boolean
          key?: string
          label?: Json
          note?: Json | null
          provisional?: boolean
          source_name?: string
          source_url?: string | null
          unit?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      benchmark_snapshots: {
        Row: {
          assumptions: Json
          company_id: string
          confidence: number | null
          cost: Json | null
          cost_chf: number | null
          cost_high_chf: number | null
          cost_low_chf: number | null
          created_at: string
          derived: Json | null
          gaps: Json
          id: string
          inputs: Json
          kpis_compared: number
          model_version: string
          organization_id: string
          peer_provisional: boolean
          research_run_id: string | null
          results: Json
          saving_median_chf: number | null
          saving_top_chf: number | null
          trigger_kind: string
          updated_at: string
        }
        Insert: {
          assumptions: Json
          company_id: string
          confidence?: number | null
          cost?: Json | null
          cost_chf?: number | null
          cost_high_chf?: number | null
          cost_low_chf?: number | null
          created_at?: string
          derived?: Json | null
          gaps: Json
          id?: string
          inputs: Json
          kpis_compared: number
          model_version: string
          organization_id: string
          peer_provisional: boolean
          research_run_id?: string | null
          results: Json
          saving_median_chf?: number | null
          saving_top_chf?: number | null
          trigger_kind: string
          updated_at?: string
        }
        Update: {
          assumptions?: Json
          company_id?: string
          confidence?: number | null
          cost?: Json | null
          cost_chf?: number | null
          cost_high_chf?: number | null
          cost_low_chf?: number | null
          created_at?: string
          derived?: Json | null
          gaps?: Json
          id?: string
          inputs?: Json
          kpis_compared?: number
          model_version?: string
          organization_id?: string
          peer_provisional?: boolean
          research_run_id?: string | null
          results?: Json
          saving_median_chf?: number | null
          saving_top_chf?: number | null
          trigger_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmark_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmark_snapshots_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmarks: {
        Row: {
          basis: Json | null
          created_at: string
          id: string
          industry_section: string
          is_assumption: boolean
          kpi_key: string
          median: number
          p25: number
          p75: number
          period_year: number
          provisional: boolean
          sample_size: number | null
          size_band: string
          source_key: string | null
          source_name: string
          source_note: Json | null
          source_url: string | null
          updated_at: string
        }
        Insert: {
          basis?: Json | null
          created_at?: string
          id?: string
          industry_section: string
          is_assumption?: boolean
          kpi_key: string
          median: number
          p25: number
          p75: number
          period_year: number
          provisional?: boolean
          sample_size?: number | null
          size_band: string
          source_key?: string | null
          source_name: string
          source_note?: Json | null
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          basis?: Json | null
          created_at?: string
          id?: string
          industry_section?: string
          is_assumption?: boolean
          kpi_key?: string
          median?: number
          p25?: number
          p75?: number
          period_year?: number
          provisional?: boolean
          sample_size?: number | null
          size_band?: string
          source_key?: string | null
          source_name?: string
          source_note?: Json | null
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmarks_kpi_key_fkey"
            columns: ["kpi_key"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      companies: {
        Row: {
          archived_at: string | null
          canton: string | null
          country: string
          created_at: string
          created_by: string | null
          employees_count: number | null
          id: string
          industry_code: string | null
          legal_name: string | null
          name: string
          organization_id: string
          uid: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          archived_at?: string | null
          canton?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          employees_count?: number | null
          id?: string
          industry_code?: string | null
          legal_name?: string | null
          name: string
          organization_id: string
          uid?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          archived_at?: string | null
          canton?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          employees_count?: number | null
          id?: string
          industry_code?: string | null
          legal_name?: string | null
          name?: string
          organization_id?: string
          uid?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "companies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_kpis: {
        Row: {
          company_id: string
          confidence: number | null
          created_at: string
          created_by: string | null
          id: string
          kpi_key: string
          note: string | null
          organization_id: string
          period_year: number
          research_run_id: string | null
          source: string
          sources: Json
          updated_at: string
          value: number
        }
        Insert: {
          company_id: string
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          kpi_key: string
          note?: string | null
          organization_id: string
          period_year: number
          research_run_id?: string | null
          source: string
          sources?: Json
          updated_at?: string
          value: number
        }
        Update: {
          company_id?: string
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          kpi_key?: string
          note?: string | null
          organization_id?: string
          period_year?: number
          research_run_id?: string | null
          source?: string
          sources?: Json
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_kpis_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_kpis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "company_kpis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_kpis_kpi_key_fkey"
            columns: ["kpi_key"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "company_kpis_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_kpis_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      data_requests: {
        Row: {
          created_at: string
          due_at: string
          handled_at: string | null
          handled_by: string | null
          id: string
          kind: string
          ops_note: string | null
          organization_id: string | null
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_at: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind: string
          ops_note?: string | null
          organization_id?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          due_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind?: string
          ops_note?: string | null
          organization_id?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_requests_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "data_requests_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "data_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      directory_companies: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          id: string
          name: string
          name_normalised: string
          state: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          name: string
          name_normalised: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          name?: string
          name_normalised?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      directory_contacts: {
        Row: {
          city: string | null
          company_id: string
          country: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          imported_at: string
          last_name: string | null
          mobile: string | null
          phone: string | null
          postal_code: string | null
          source_batch: string
          state: string | null
          street: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          company_id: string
          country?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          imported_at: string
          last_name?: string | null
          mobile?: string | null
          phone?: string | null
          postal_code?: string | null
          source_batch: string
          state?: string | null
          street?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          company_id?: string
          country?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          imported_at?: string
          last_name?: string | null
          mobile?: string | null
          phone?: string | null
          postal_code?: string | null
          source_batch?: string
          state?: string | null
          street?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "directory_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "directory_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      directory_credit_entries: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          expert_id: string
          id: string
          note: string | null
          order_id: string | null
          reason: string
          unlock_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          expert_id: string
          id?: string
          note?: string | null
          order_id?: string | null
          reason: string
          unlock_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          expert_id?: string
          id?: string
          note?: string | null
          order_id?: string | null
          reason?: string
          unlock_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "directory_credit_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "directory_credit_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directory_credit_entries_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "directory_credit_entries_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directory_credit_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "expert_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directory_credit_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directory_credit_entries_unlock_id_fkey"
            columns: ["unlock_id"]
            isOneToOne: false
            referencedRelation: "directory_unlocks"
            referencedColumns: ["id"]
          },
        ]
      }
      directory_imports: {
        Row: {
          countries: Json
          created_at: string
          dry_run: boolean
          excluded_countries: string[]
          file_name: string
          finished_at: string | null
          id: string
          rows_loaded: number
          rows_read: number
          rows_skipped_country: number
          rows_skipped_invalid: number
          rows_skipped_no_country: number
          rows_skipped_suppressed: number
          rows_updated: number
          source_batch: string
          started_at: string
        }
        Insert: {
          countries?: Json
          created_at?: string
          dry_run?: boolean
          excluded_countries?: string[]
          file_name: string
          finished_at?: string | null
          id?: string
          rows_loaded?: number
          rows_read?: number
          rows_skipped_country?: number
          rows_skipped_invalid?: number
          rows_skipped_no_country?: number
          rows_skipped_suppressed?: number
          rows_updated?: number
          source_batch: string
          started_at?: string
        }
        Update: {
          countries?: Json
          created_at?: string
          dry_run?: boolean
          excluded_countries?: string[]
          file_name?: string
          finished_at?: string | null
          id?: string
          rows_loaded?: number
          rows_read?: number
          rows_skipped_country?: number
          rows_skipped_invalid?: number
          rows_skipped_no_country?: number
          rows_skipped_suppressed?: number
          rows_updated?: number
          source_batch?: string
          started_at?: string
        }
        Relationships: []
      }
      directory_suppressions: {
        Row: {
          created_at: string
          created_by: string | null
          email_hash: string
          reason: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email_hash: string
          reason: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email_hash?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "directory_suppressions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "directory_suppressions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      directory_unlocks: {
        Row: {
          contact_id: string
          created_at: string
          expert_id: string
          id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          expert_id: string
          id?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          expert_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "directory_unlocks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "directory_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directory_unlocks_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "directory_unlocks_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_deliveries: {
        Row: {
          attempts: number
          created_at: string
          data: Json
          delivered_at: string | null
          error: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_run_id: string | null
          locale: string
          organization_id: string | null
          provider_message_id: string | null
          recipient_email: string
          recipient_id: string | null
          sent_at: string | null
          source_event: string
          status: string
          subject: string | null
          template: string
          transport: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          data?: Json
          delivered_at?: string | null
          error?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key: string
          last_run_id?: string | null
          locale: string
          organization_id?: string | null
          provider_message_id?: string | null
          recipient_email: string
          recipient_id?: string | null
          sent_at?: string | null
          source_event: string
          status?: string
          subject?: string | null
          template: string
          transport?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          data?: Json
          delivered_at?: string | null
          error?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          last_run_id?: string | null
          locale?: string
          organization_id?: string | null
          provider_message_id?: string | null
          recipient_email?: string
          recipient_id?: string | null
          sent_at?: string | null
          source_event?: string
          status?: string
          subject?: string | null
          template?: string
          transport?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enquiries: {
        Row: {
          company_name: string
          contact_name: string
          created_at: string
          email: string
          handled_at: string | null
          handled_by: string | null
          headcount_band: string | null
          id: string
          ip_hash: string | null
          locale: string
          message: string
          ops_note: string | null
          organization_id: string | null
          phone: string | null
          status: string
          submitted_by: string | null
          topic: string
          updated_at: string
        }
        Insert: {
          company_name: string
          contact_name: string
          created_at?: string
          email: string
          handled_at?: string | null
          handled_by?: string | null
          headcount_band?: string | null
          id?: string
          ip_hash?: string | null
          locale: string
          message: string
          ops_note?: string | null
          organization_id?: string | null
          phone?: string | null
          status?: string
          submitted_by?: string | null
          topic: string
          updated_at?: string
        }
        Update: {
          company_name?: string
          contact_name?: string
          created_at?: string
          email?: string
          handled_at?: string | null
          handled_by?: string | null
          headcount_band?: string | null
          id?: string
          ip_hash?: string | null
          locale?: string
          message?: string
          ops_note?: string | null
          organization_id?: string | null
          phone?: string | null
          status?: string
          submitted_by?: string | null
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enquiries_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "enquiries_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enquiries_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "enquiries_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_assignments: {
        Row: {
          assigned_by: string | null
          created_at: string
          ended_at: string | null
          expert_id: string
          id: string
          organization_id: string
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          ended_at?: string | null
          expert_id: string
          id?: string
          organization_id: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          ended_at?: string | null
          expert_id?: string
          id?: string
          organization_id?: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "expert_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_assignments_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "expert_assignments_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_ops_notes: {
        Row: {
          created_at: string
          expert_id: string
          notes: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          expert_id: string
          notes?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          expert_id?: string
          notes?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_ops_notes_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "expert_ops_notes_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_ops_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "expert_ops_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_profiles: {
        Row: {
          availability: string
          availability_note: string | null
          available_from: string | null
          bio: string | null
          competencies: string[]
          created_at: string
          deactivated_at: string | null
          email: string
          expert_id: string
          headline: string | null
          industries: string[]
          invited_at: string
          invited_by: string | null
          languages: string[]
          onboarded_at: string | null
          phone: string | null
          photo_path: string | null
          regions: string[]
          standards: string[]
          status: string
          updated_at: string
          years_experience: number | null
        }
        Insert: {
          availability?: string
          availability_note?: string | null
          available_from?: string | null
          bio?: string | null
          competencies?: string[]
          created_at?: string
          deactivated_at?: string | null
          email: string
          expert_id: string
          headline?: string | null
          industries?: string[]
          invited_at?: string
          invited_by?: string | null
          languages?: string[]
          onboarded_at?: string | null
          phone?: string | null
          photo_path?: string | null
          regions?: string[]
          standards?: string[]
          status?: string
          updated_at?: string
          years_experience?: number | null
        }
        Update: {
          availability?: string
          availability_note?: string | null
          available_from?: string | null
          bio?: string | null
          competencies?: string[]
          created_at?: string
          deactivated_at?: string | null
          email?: string
          expert_id?: string
          headline?: string | null
          industries?: string[]
          invited_at?: string
          invited_by?: string | null
          languages?: string[]
          onboarded_at?: string | null
          phone?: string | null
          photo_path?: string | null
          regions?: string[]
          standards?: string[]
          status?: string
          updated_at?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_profiles_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "expert_profiles_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_profiles_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "expert_profiles_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          buyer_expert_id: string | null
          cancelled_at: string | null
          created_at: string
          due_date: string
          id: string
          issued_at: string
          number: string
          order_id: string
          organization_id: string | null
          pdf_failed_at: string | null
          pdf_path: string | null
          pdf_rendered_at: string | null
          qr_reference: string
          seller_address: string
          seller_iban: string
          seller_name: string
          seller_uid: string
          updated_at: string
        }
        Insert: {
          buyer_expert_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          due_date: string
          id?: string
          issued_at?: string
          number: string
          order_id: string
          organization_id?: string | null
          pdf_failed_at?: string | null
          pdf_path?: string | null
          pdf_rendered_at?: string | null
          qr_reference: string
          seller_address: string
          seller_iban: string
          seller_name: string
          seller_uid: string
          updated_at?: string
        }
        Update: {
          buyer_expert_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          due_date?: string
          id?: string
          issued_at?: string
          number?: string
          order_id?: string
          organization_id?: string | null
          pdf_failed_at?: string | null
          pdf_path?: string | null
          pdf_rendered_at?: string | null
          qr_reference?: string
          seller_address?: string
          seller_iban?: string
          seller_name?: string
          seller_uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_buyer_expert_id_fkey"
            columns: ["buyer_expert_id"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "invoices_buyer_expert_id_fkey"
            columns: ["buyer_expert_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "expert_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_definitions: {
        Row: {
          created_at: string
          description: Json | null
          direction: string
          is_active: boolean
          key: string
          name: Json
          sort_order: number
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: Json | null
          direction: string
          is_active?: boolean
          key: string
          name: Json
          sort_order?: number
          unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: Json | null
          direction?: string
          is_active?: boolean
          key?: string
          name?: Json
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          data: Json
          delivery_id: string | null
          id: string
          kind: string
          link: string | null
          organization_id: string | null
          read_at: string | null
          recipient_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          delivery_id?: string | null
          id?: string
          kind: string
          link?: string | null
          organization_id?: string | null
          read_at?: string | null
          recipient_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          delivery_id?: string | null
          id?: string
          kind?: string
          link?: string | null
          organization_id?: string | null
          read_at?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "email_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_id: string | null
          actor_role: string
          from_status: string | null
          id: string
          occurred_at: string
          order_id: string
          organization_id: string | null
          reason: string | null
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          actor_role: string
          from_status?: string | null
          id?: string
          occurred_at?: string
          order_id: string
          organization_id?: string | null
          reason?: string | null
          to_status: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string
          from_status?: string | null
          id?: string
          occurred_at?: string
          order_id?: string
          organization_id?: string | null
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "expert_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          assigned_expert_id: string | null
          billing_country: string
          billing_name: string
          billing_postcode: string
          billing_street: string
          billing_town: string
          billing_uid: string | null
          buyer_expert_id: string | null
          cancelled_at: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          credits: number | null
          currency: string
          delivered_at: string | null
          due_date: string | null
          expires_at: string | null
          gross_rappen: number
          id: string
          locale: string
          net_rappen: number
          organization_id: string | null
          package_key: string
          package_name_snapshot: string
          paid_at: string | null
          payment_method: string
          reference: string
          scheduled_at: string | null
          scheduled_by: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
          vat_rappen: number
          vat_rate: number
        }
        Insert: {
          assigned_expert_id?: string | null
          billing_country?: string
          billing_name: string
          billing_postcode: string
          billing_street: string
          billing_town: string
          billing_uid?: string | null
          buyer_expert_id?: string | null
          cancelled_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          credits?: number | null
          currency?: string
          delivered_at?: string | null
          due_date?: string | null
          expires_at?: string | null
          gross_rappen: number
          id?: string
          locale: string
          net_rappen: number
          organization_id?: string | null
          package_key: string
          package_name_snapshot: string
          paid_at?: string | null
          payment_method: string
          reference: string
          scheduled_at?: string | null
          scheduled_by?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          vat_rappen: number
          vat_rate: number
        }
        Update: {
          assigned_expert_id?: string | null
          billing_country?: string
          billing_name?: string
          billing_postcode?: string
          billing_street?: string
          billing_town?: string
          billing_uid?: string | null
          buyer_expert_id?: string | null
          cancelled_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          credits?: number | null
          currency?: string
          delivered_at?: string | null
          due_date?: string | null
          expires_at?: string | null
          gross_rappen?: number
          id?: string
          locale?: string
          net_rappen?: number
          organization_id?: string | null
          package_key?: string
          package_name_snapshot?: string
          paid_at?: string | null
          payment_method?: string
          reference?: string
          scheduled_at?: string | null
          scheduled_by?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          vat_rappen?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_assigned_expert_id_fkey"
            columns: ["assigned_expert_id"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "orders_assigned_expert_id_fkey"
            columns: ["assigned_expert_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_buyer_expert_id_fkey"
            columns: ["buyer_expert_id"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "orders_buyer_expert_id_fkey"
            columns: ["buyer_expert_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_package_key_fkey"
            columns: ["package_key"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "orders_scheduled_by_fkey"
            columns: ["scheduled_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "orders_scheduled_by_fkey"
            columns: ["scheduled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          locale: string
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          locale?: string
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          locale?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          created_at: string
          credits: number | null
          is_active: boolean
          key: string
          kind: string
          price_rappen: number | null
          sort_order: number
          updated_at: string
          vat_rate: number
        }
        Insert: {
          created_at?: string
          credits?: number | null
          is_active?: boolean
          key: string
          kind?: string
          price_rappen?: number | null
          sort_order: number
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          created_at?: string
          credits?: number | null
          is_active?: boolean
          key?: string
          kind?: string
          price_rappen?: number | null
          sort_order?: number
          updated_at?: string
          vat_rate?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          locale: string
          organization_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          terms_accepted_at: string | null
          terms_version: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          terms_accepted_at?: string | null
          terms_version?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          terms_accepted_at?: string | null
          terms_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      questionnaire_items: {
        Row: {
          created_at: string
          de_reviewed: boolean
          group_key: string | null
          id: string
          label: string
          parent_id: string | null
          position: number
          question: Json
          rateable: boolean
          requirement: Json | null
          section_key: string
          title: Json
          updated_at: string
          version_key: string
        }
        Insert: {
          created_at?: string
          de_reviewed?: boolean
          group_key?: string | null
          id: string
          label: string
          parent_id?: string | null
          position: number
          question: Json
          rateable: boolean
          requirement?: Json | null
          section_key: string
          title: Json
          updated_at?: string
          version_key: string
        }
        Update: {
          created_at?: string
          de_reviewed?: boolean
          group_key?: string | null
          id?: string
          label?: string
          parent_id?: string | null
          position?: number
          question?: Json
          rateable?: boolean
          requirement?: Json | null
          section_key?: string
          title?: Json
          updated_at?: string
          version_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "questionnaire_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "questionnaire_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questionnaire_items_version_key_fkey"
            columns: ["version_key"]
            isOneToOne: false
            referencedRelation: "questionnaire_versions"
            referencedColumns: ["key"]
          },
        ]
      }
      questionnaire_versions: {
        Row: {
          created_at: string
          item_count: number
          key: string
          questionnaire_key: string
          sections: Json
          source_note: string | null
          title: Json
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          item_count: number
          key: string
          questionnaire_key: string
          sections: Json
          source_note?: string | null
          title: Json
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          item_count?: number
          key?: string
          questionnaire_key?: string
          sections?: Json
          source_note?: string | null
          title?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      research_runs: {
        Row: {
          company_id: string
          created_at: string
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          organization_id: string
          provider_run_id: string | null
          requested_by: string | null
          started_at: string | null
          status: string
          summary: Json | null
          trigger_run_id: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          provider_run_id?: string | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
          summary?: Json | null
          trigger_run_id?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          provider_run_id?: string | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
          summary?: Json | null
          trigger_run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "research_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scaffold_checks: {
        Row: {
          created_at: string
          id: string
          message: string
          run_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          run_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          run_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          error: string | null
          event_id: string
          payload: Json
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          error?: string | null
          event_id: string
          payload: Json
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          error?: string | null
          event_id?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
    }
    Views: {
      assigned_expert_summaries: {
        Row: {
          assignment_id: string | null
          bio: string | null
          competencies: string[] | null
          expert_id: string | null
          full_name: string | null
          headline: string | null
          industries: string[] | null
          languages: string[] | null
          organization_id: string | null
          photo_path: string | null
          standards: string[] | null
          started_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_kpi_current: {
        Row: {
          company_id: string | null
          confidence: number | null
          created_at: string | null
          created_by: string | null
          id: string | null
          kpi_key: string | null
          note: string | null
          organization_id: string | null
          period_year: number | null
          research_run_id: string | null
          source: string | null
          sources: Json | null
          updated_at: string | null
          value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "company_kpis_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_kpis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "assigned_expert_summaries"
            referencedColumns: ["expert_id"]
          },
          {
            foreignKeyName: "company_kpis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_kpis_kpi_key_fkey"
            columns: ["kpi_key"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "company_kpis_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_kpis_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_bookings: {
        Row: {
          company_id: string | null
          delivered_at: string | null
          id: string | null
          organization_id: string | null
          package_key: string | null
          package_name_snapshot: string | null
          reference: string | null
          scheduled_at: string | null
          status: string | null
        }
        Insert: {
          company_id?: string | null
          delivered_at?: string | null
          id?: string | null
          organization_id?: string | null
          package_key?: string | null
          package_name_snapshot?: string | null
          reference?: string | null
          scheduled_at?: string | null
          status?: string | null
        }
        Update: {
          company_id?: string | null
          delivered_at?: string | null
          id?: string | null
          organization_id?: string | null
          package_key?: string | null
          package_name_snapshot?: string | null
          reference?: string | null
          scheduled_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_package_key_fkey"
            columns: ["package_key"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["key"]
          },
        ]
      }
    }
    Functions: {
      accept_terms: { Args: { version?: string }; Returns: string }
      add_organization_member: {
        Args: { organization_id: string; role?: string; user_id: string }
        Returns: string
      }
      assigned_organization_contacts: {
        Args: { org: string }
        Returns: {
          email: string
          full_name: string
          role: string
          user_id: string
        }[]
      }
      create_organization: { Args: { name: string }; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      directory_countries: {
        Args: never
        Returns: {
          contacts: number
          country: string
        }[]
      }
      directory_credit_balance: {
        Args: { expert_id?: string }
        Returns: number
      }
      directory_ops_summary: {
        Args: never
        Returns: {
          balance: number
          credits_bought: number
          email: string
          expert_id: string
          full_name: string
          last_unlock_at: string
          unlocks: number
        }[]
      }
      directory_remove_contact: {
        Args: { email: string; reason: string }
        Returns: {
          removed: boolean
          unlocks_cascaded: number
        }[]
      }
      directory_reveal: {
        Args: { contact_id: string }
        Returns: {
          already_unlocked: boolean
          balance: number
          company_city: string
          company_country: string
          company_id: string
          company_name: string
          contact_city: string
          contact_country: string
          contact_title: string
          email: string
          first_name: string
          id: string
          last_name: string
          mobile: string
          phone: string
          unlocked_at: string
        }[]
      }
      directory_search: {
        Args: {
          after_id?: string
          after_name?: string
          after_page?: number
          country?: string
          page_size?: number
          q?: string
          title?: string
        }
        Returns: {
          company_city: string
          company_country: string
          company_id: string
          company_name: string
          company_name_normalised: string
          contact_city: string
          contact_country: string
          contact_id: string
          contact_title: string
          email: string
          email_masked: string
          first_name: string
          last_name: string
          mobile: string
          mobile_masked: string
          phone: string
          phone_masked: string
          unlocked: boolean
        }[]
      }
      directory_unlocked_contacts: {
        Args: {
          after_created_at?: string
          after_id?: string
          page_size?: number
        }
        Returns: {
          company_city: string
          company_country: string
          company_id: string
          company_name: string
          contact_city: string
          contact_country: string
          contact_title: string
          email: string
          first_name: string
          id: string
          last_name: string
          mobile: string
          phone: string
          unlock_id: string
          unlocked_at: string
        }[]
      }
      issue_invoice: {
        Args: {
          due_days?: number
          order_id: string
          seller_address: string
          seller_iban: string
          seller_name: string
          seller_uid: string
        }
        Returns: {
          invoice_id: string
          invoice_number: string
          qr_reference: string
        }[]
      }
      next_order_reference: { Args: never; Returns: string }
      scor_reference: { Args: { body: string }; Returns: string }
      set_expert_photo: {
        Args: { path: string }
        Returns: {
          availability: string
          availability_note: string | null
          available_from: string | null
          bio: string | null
          competencies: string[]
          created_at: string
          deactivated_at: string | null
          email: string
          expert_id: string
          headline: string | null
          industries: string[]
          invited_at: string
          invited_by: string | null
          languages: string[]
          onboarded_at: string | null
          phone: string | null
          photo_path: string | null
          regions: string[]
          standards: string[]
          status: string
          updated_at: string
          years_experience: number | null
        }
        SetofOptions: {
          from: "*"
          to: "expert_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_expert_status: {
        Args: { next: string; target: string }
        Returns: {
          availability: string
          availability_note: string | null
          available_from: string | null
          bio: string | null
          competencies: string[]
          created_at: string
          deactivated_at: string | null
          email: string
          expert_id: string
          headline: string | null
          industries: string[]
          invited_at: string
          invited_by: string | null
          languages: string[]
          onboarded_at: string | null
          phone: string | null
          photo_path: string | null
          regions: string[]
          standards: string[]
          status: string
          updated_at: string
          years_experience: number | null
        }
        SetofOptions: {
          from: "*"
          to: "expert_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_order: {
        Args: {
          actor_id: string
          actor_role: string
          due_days?: number
          order_id: string
          paid_at: string
          seller_address: string
          seller_iban: string
          seller_name: string
          seller_uid: string
        }
        Returns: {
          already_settled: boolean
          invoice_id: string
          invoice_number: string
          qr_reference: string
        }[]
      }
    }
    Enums: {
      app_role: "client" | "expert" | "ops"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["client", "expert", "ops"],
    },
  },
} as const

