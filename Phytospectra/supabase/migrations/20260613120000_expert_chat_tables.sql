-- Expert chat: farmer ↔ agronomist conversations and messages

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agronomist_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  zone TEXT NOT NULL DEFAULT '',
  issue TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX conversations_farmer_idx ON public.conversations (farmer_id);
CREATE INDEX conversations_agronomist_idx ON public.conversations (agronomist_id);
CREATE INDEX conversations_status_idx ON public.conversations (status);

CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role public.app_role NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_conversation_idx ON public.chat_messages (conversation_id, created_at);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Participants can read their own threads (direct Supabase access)
CREATE POLICY "Participants read conversations"
  ON public.conversations FOR SELECT
  USING (auth.uid() = farmer_id OR auth.uid() = agronomist_id);

CREATE POLICY "Farmers create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (auth.uid() = farmer_id);

CREATE POLICY "Participants read chat messages"
  ON public.chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.farmer_id = auth.uid() OR c.agronomist_id = auth.uid())
    )
  );

CREATE POLICY "Participants send chat messages"
  ON public.chat_messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.farmer_id = auth.uid() OR c.agronomist_id = auth.uid())
    )
  );
