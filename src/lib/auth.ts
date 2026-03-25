import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createServerClient } from "@/lib/supabase";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Tenkara Inbox",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const supabase = createServerClient();

        const { data: member } = await supabase
          .from("team_members")
          .select("*")
          .eq("email", credentials.email.trim().toLowerCase())
          .eq("is_active", true)
          .single();

        if (!member) return null;

        // Do not allow login until invite has been accepted
        if (!member.password_hash || !member.accepted_at) {
          return null;
        }

        const valid = await bcrypt.compare(
          credentials.password,
          member.password_hash
        );

        if (!valid) return null;

        return {
          id: member.id,
          email: member.email,
          name: member.name,
          image: member.avatar_url,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;

        const supabase = createServerClient();
        const { data: member } = await supabase
          .from("team_members")
          .select("*")
          .eq("id", token.id)
          .single();

        if (member) {
          (session as any).teamMember = member;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };