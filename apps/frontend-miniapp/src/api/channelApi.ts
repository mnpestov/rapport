import { API_URL } from "./config";

export interface ChannelInfo {
  title: string | null;
  username: string | null;
  photoUrl: string | null;
  subscriberCount: number;
  description: string | null;
}

export const fetchChannelInfo = async (): Promise<ChannelInfo | null> => {
  try {
    const response = await fetch(`${API_URL}/channel`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data: ChannelInfo = await response.json();
    return data;
  } catch (error) {
    console.error("[ChannelApi] Failed to fetch channel info:", error);
    return null;
  }
};
