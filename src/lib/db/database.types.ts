
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "chat_messages": {
                  Row: {
                    "created_at": string,"id": string,"option_set_id": string | null,"sender_member_id": string | null,"text": string,"trip_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"option_set_id"?: string | null,"sender_member_id"?: string | null,"text": string,"trip_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"option_set_id"?: string | null,"sender_member_id"?: string | null,"text"?: string,"trip_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_messages_option_set_fk"
      columns: ["option_set_id"]
isOneToOne: false
      referencedRelation: "option_sets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_messages_sender_member_id_trip_id_fkey"
      columns: ["sender_member_id","trip_id"]
isOneToOne: false
      referencedRelation: "trip_members"
      referencedColumns: ["id","trip_id"]
    },{
      foreignKeyName: "chat_messages_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"credit_events": {
                  Row: {
                    "change": number,"created_at": string,"id": string,"member_id": string,"option_set_id": string,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "change": number,"created_at"?: string,"id"?: string,"member_id": string,"option_set_id": string,"reason": string
                  }
                  Update: {
                    "change"?: number,"created_at"?: string,"id"?: string,"member_id"?: string,"option_set_id"?: string,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_events_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "trip_members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_events_option_set_id_fkey"
      columns: ["option_set_id"]
isOneToOne: false
      referencedRelation: "option_sets"
      referencedColumns: ["id"]
    }
                  ]
                },"decisions": {
                  Row: {
                    "chosen_option_id": string,"decided_at": string,"option_set_id": string,"resolved_by": string,"split_accepted_by": (string)[] | null,"trip_id": string,"voter_ids": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "chosen_option_id": string,"decided_at"?: string,"option_set_id": string,"resolved_by": string,"split_accepted_by"?: (string)[] | null,"trip_id": string,"voter_ids"?: (string)[]
                  }
                  Update: {
                    "chosen_option_id"?: string,"decided_at"?: string,"option_set_id"?: string,"resolved_by"?: string,"split_accepted_by"?: (string)[] | null,"trip_id"?: string,"voter_ids"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "decisions_option_set_id_fkey"
      columns: ["option_set_id"]
isOneToOne: true
      referencedRelation: "option_sets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decisions_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"itinerary_items": {
                  Row: {
                    "branches": Json | null,"created_at": string,"day": number,"end_time": string,"id": string,"option_set_id": string | null,"spot_id": string | null,"start_time": string,"trip_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branches"?: Json | null,"created_at"?: string,"day": number,"end_time": string,"id"?: string,"option_set_id"?: string | null,"spot_id"?: string | null,"start_time": string,"trip_id": string
                  }
                  Update: {
                    "branches"?: Json | null,"created_at"?: string,"day"?: number,"end_time"?: string,"id"?: string,"option_set_id"?: string | null,"spot_id"?: string | null,"start_time"?: string,"trip_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "itinerary_items_option_set_id_fkey"
      columns: ["option_set_id"]
isOneToOne: false
      referencedRelation: "option_sets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "itinerary_items_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"member_private": {
                  Row: {
                    "allergies": (string)[],"interview_topics": (string)[],"max_budget": number | null,"member_id": string,"preference_statements": (string)[],"private_note": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allergies"?: (string)[],"interview_topics"?: (string)[],"max_budget"?: number | null,"member_id": string,"preference_statements"?: (string)[],"private_note"?: string,"updated_at"?: string
                  }
                  Update: {
                    "allergies"?: (string)[],"interview_topics"?: (string)[],"max_budget"?: number | null,"member_id"?: string,"preference_statements"?: (string)[],"private_note"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_private_member_id_fkey"
      columns: ["member_id"]
isOneToOne: true
      referencedRelation: "trip_members"
      referencedColumns: ["id"]
    }
                  ]
                },"member_state": {
                  Row: {
                    "definitely_no_day": string | null,"definitely_no_used_today": number,"fairness_credits": number,"member_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "definitely_no_day"?: string | null,"definitely_no_used_today"?: number,"fairness_credits"?: number,"member_id": string
                  }
                  Update: {
                    "definitely_no_day"?: string | null,"definitely_no_used_today"?: number,"fairness_credits"?: number,"member_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_state_member_id_fkey"
      columns: ["member_id"]
isOneToOne: true
      referencedRelation: "trip_members"
      referencedColumns: ["id"]
    }
                  ]
                },"option_sets": {
                  Row: {
                    "candidate_option_id": string,"chosen_option_id": string | null,"created_at": string,"id": string,"options": NonNullable<Json>,"round": number,"round_deadline": string,"slot": NonNullable<Json>,"status": string,"trip_id": string,"vote_attempt": number | null,"vote_deadline": string | null,"voter_ids": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "candidate_option_id": string,"chosen_option_id"?: string | null,"created_at"?: string,"id"?: string,"options"?: NonNullable<Json>,"round"?: number,"round_deadline": string,"slot": NonNullable<Json>,"status"?: string,"trip_id": string,"vote_attempt"?: number | null,"vote_deadline"?: string | null,"voter_ids"?: (string)[]
                  }
                  Update: {
                    "candidate_option_id"?: string,"chosen_option_id"?: string | null,"created_at"?: string,"id"?: string,"options"?: NonNullable<Json>,"round"?: number,"round_deadline"?: string,"slot"?: NonNullable<Json>,"status"?: string,"trip_id"?: string,"vote_attempt"?: number | null,"vote_deadline"?: string | null,"voter_ids"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "option_sets_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"private_messages": {
                  Row: {
                    "constraints_status": string | null,"constraints_to_confirm": Json | null,"created_at": string,"id": string,"member_id": string,"round": number | null,"sender": string,"text": string,"trip_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "constraints_status"?: string | null,"constraints_to_confirm"?: Json | null,"created_at"?: string,"id"?: string,"member_id": string,"round"?: number | null,"sender": string,"text": string,"trip_id": string
                  }
                  Update: {
                    "constraints_status"?: string | null,"constraints_to_confirm"?: Json | null,"created_at"?: string,"id"?: string,"member_id"?: string,"round"?: number | null,"sender"?: string,"text"?: string,"trip_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "private_messages_member_id_trip_id_fkey"
      columns: ["member_id","trip_id"]
isOneToOne: false
      referencedRelation: "trip_members"
      referencedColumns: ["id","trip_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"slot_proposals": {
                  Row: {
                    "confirmed_by": string | null,"created_at": string,"id": string,"kind": string,"requested_by": string | null,"slot": NonNullable<Json>,"status": string,"trip_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "confirmed_by"?: string | null,"created_at"?: string,"id"?: string,"kind": string,"requested_by"?: string | null,"slot": NonNullable<Json>,"status"?: string,"trip_id": string
                  }
                  Update: {
                    "confirmed_by"?: string | null,"created_at"?: string,"id"?: string,"kind"?: string,"requested_by"?: string | null,"slot"?: NonNullable<Json>,"status"?: string,"trip_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "slot_proposals_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "trip_members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "slot_proposals_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "trip_members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "slot_proposals_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"trip_members": {
                  Row: {
                    "diet": (string)[],"id": string,"interests": (string)[],"joined_at": string,"name": string,"onboarding_status": string,"pace": string | null,"sleep": string | null,"trip_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "diet"?: (string)[],"id"?: string,"interests"?: (string)[],"joined_at"?: string,"name": string,"onboarding_status"?: string,"pace"?: string | null,"sleep"?: string | null,"trip_id": string,"user_id": string
                  }
                  Update: {
                    "diet"?: (string)[],"id"?: string,"interests"?: (string)[],"joined_at"?: string,"name"?: string,"onboarding_status"?: string,"pace"?: string | null,"sleep"?: string | null,"trip_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trip_members_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"trips": {
                  Row: {
                    "city": string,"created_at": string,"created_by": string | null,"end_date": string,"goal": string,"id": string,"invite_code": string,"name": string,"start_date": string,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "city": string,"created_at"?: string,"created_by"?: string | null,"end_date": string,"goal"?: string,"id"?: string,"invite_code"?: string,"name": string,"start_date": string,"timezone"?: string
                  }
                  Update: {
                    "city"?: string,"created_at"?: string,"created_by"?: string | null,"end_date"?: string,"goal"?: string,"id"?: string,"invite_code"?: string,"name"?: string,"start_date"?: string,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"votes": {
                  Row: {
                    "accepts_split": boolean | null,"created_at": string,"critique": string | null,"level": string,"member_id": string,"option_id": string,"option_set_id": string,"vote_attempt": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accepts_split"?: boolean | null,"created_at"?: string,"critique"?: string | null,"level": string,"member_id": string,"option_id": string,"option_set_id": string,"vote_attempt"?: number
                  }
                  Update: {
                    "accepts_split"?: boolean | null,"created_at"?: string,"critique"?: string | null,"level"?: string,"member_id"?: string,"option_id"?: string,"option_set_id"?: string,"vote_attempt"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "votes_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "trip_members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "votes_option_set_id_fkey"
      columns: ["option_set_id"]
isOneToOne: false
      referencedRelation: "option_sets"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "is_trip_member":
{ Args: { "p_trip_id": string }; Returns: boolean
                           },
"join_trip":
{ Args: { "p_invite_code": string }; Returns: string
                           },
"owns_member":
{ Args: { "p_member_id": string }; Returns: boolean
                           },
"trip_preview":
{ Args: { "p_invite_code": string }; Returns: {
              "city": string,"end_date": string,"member_count": number,"name": string,"start_date": string,"trip_id": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
