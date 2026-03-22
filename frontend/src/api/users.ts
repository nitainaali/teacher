import client from "./client";

export interface User {
  id: string;
  username: string;
  is_admin: boolean;
  has_password: boolean;
  created_at: string;
}

export async function getUsers(): Promise<User[]> {
  const res = await client.get<User[]>("/api/users/");
  return res.data;
}

export async function createUser(username: string): Promise<User> {
  const res = await client.post<User>("/api/users/", { username });
  return res.data;
}

export async function verifyPassword(user_id: string, password: string): Promise<void> {
  await client.post("/api/users/verify-password", { user_id, password });
}

export async function deleteMyUser(): Promise<void> {
  await client.delete("/api/users/me");
}

export async function deleteUser(id: string): Promise<void> {
  await client.delete(`/api/users/${id}`);
}
