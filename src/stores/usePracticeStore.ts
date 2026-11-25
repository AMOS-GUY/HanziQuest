import { create } from 'zustand';

interface PracticeCharacter {
    hanzi: string;
    meaning: string;
}

interface PracticeState {
    characters: PracticeCharacter[];
    currentIndex: number;
    score: number;
    streak: number;

    nextCharacter: () => void;
    incrementScore: () => void;
    resetSession: () => void;
}

export const usePracticeStore = create<PracticeState>((set) => ({
    // Now we store objects with meaning!
    characters: [
        { hanzi: "你", meaning: "You" },
        { hanzi: "好", meaning: "Good" },
        { hanzi: "我", meaning: "I / Me" },
        { hanzi: "是", meaning: "To be / Is" }
    ],
    currentIndex: 0,
    score: 0,
    streak: 0,

    nextCharacter: () => set((state) => ({
        currentIndex: (state.currentIndex + 1) % state.characters.length
    })),

    incrementScore: () => set((state) => ({
        score: state.score + 1,
        streak: state.streak + 1
    })),

    resetSession: () => set({ score: 0, streak: 0, currentIndex: 0 }),
}));