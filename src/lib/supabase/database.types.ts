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
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          locale: string
          organization_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
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
      research_runs: {
        Row: {
          company_id: string
          created_at: string
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          organization_id: string
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
    }
    Views: {
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
    }
    Functions: {
      add_organization_member: {
        Args: { organization_id: string; role?: string; user_id: string }
        Returns: string
      }
      create_organization: { Args: { name: string }; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
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

