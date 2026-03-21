import client from "./client";

export interface User {
  id: string;
  username: string;
  is_admin: boolean;
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
