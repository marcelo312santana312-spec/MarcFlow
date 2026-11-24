import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";

const googleEnabled =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            authorization: {
              params: {
                prompt: "select_account",
              },
            },
          }),
        ]
      : []),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;

          const user = await prisma.user.findUnique({ where: { email } });
          if (!user) return null;

          const passwordsMatch = await bcrypt.compare(password, user.password);

          if (passwordsMatch) {
            return user;
          }
        }
        return null;
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // Allow credentials sign-in to proceed normally
      if (account?.provider === "credentials") return true;

      // For Google OAuth: create or update user in DB
      if (account?.provider === "google" && user?.email) {
        const allowNew = process.env.GOOGLE_ALLOW_NEW_USERS !== "false";

        let dbUser = await prisma.user.findUnique({
          where: { email: user.email },
        });

        if (!dbUser) {
          if (!allowNew) {
            // Block new users if disabled
            return false;
          }
          // Auto-create user with a random unusable password
          const randomPassword = await bcrypt.hash(
            Math.random().toString(36) + Date.now().toString(36),
            10
          );
          dbUser = await prisma.user.create({
            data: {
              email: user.email,
              name: user.name ?? user.email.split("@")[0],
              password: randomPassword,
              role: "OWNER",
            },
          });
        }

        // Inject DB id and role into the user object so session callbacks pick them up
        user.id = dbUser.id;
        (user as { role?: string }).role = dbUser.role;
        return true;
      }

      return true;
    },
  },
  secret: process.env.AUTH_SECRET,
});
