'use client';

import { GameBoard } from './GameBoard';
import { GameControls } from './GameControls';
import type { Game as ReplayGame } from '../types';

interface GameAreaProps {
    state: any;
    dispatch: (action: any) => void;
    replayGame: ReplayGame | null;
}

const GameArea = ({ state, dispatch, replayGame }: GameAreaProps) => {
    const handleBoardClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const style = window.getComputedStyle(event.currentTarget);
        const paddingLeft = parseFloat(style.paddingLeft);
        const paddingTop = parseFloat(style.paddingTop);
        const gridWidth = event.currentTarget.clientWidth - paddingLeft * 2;
        const gridHeight = event.currentTarget.clientHeight - paddingTop * 2;
        const x = event.clientX - rect.left - paddingLeft;
        const y = event.clientY - rect.top - paddingTop;
        if (x < 0 || x > gridWidth || y < 0 || y > gridHeight) return;
        const row = Math.round((y / gridHeight) * (19 - 1));
        const col = Math.round((x / gridWidth) * (19 - 1));
        if (row < 0 || row >= 19 || col < 0 || col >= 19) return;

        if (state.isWhatIfMode) {
            dispatch({ type: 'PLACE_WHAT_IF_STONE', payload: { row, col } });
        } else if (state.gameState !== 'replay') { // Prevent placing stones during replay
            dispatch({ type: 'PLACE_STONE', payload: { row, col } });
        }
    };

    const getLastMove = () => {
        if (state.isWhatIfMode) {
            return state.whatIfLastMove;
        }
        if (state.gameState === 'replay') {
            if (state.replayMoveIndex === 0) return null;
            return state.history[state.replayMoveIndex - 1];
        }
        if (state.history.length === 0) return null;
        return state.history[state.history.length - 1];
    };

    return (
        <>
            <GameBoard
                board={state.isWhatIfMode ? state.whatIfBoard : state.board}
                lastMove={getLastMove()}
                isSpectator={state.isSpectator}
                handleBoardClick={handleBoardClick}
                gameMode={state.gameMode}
                currentPlayer={state.currentPlayer}
                aiPlayer={state.aiPlayer}
                gameState={state.gameState}
                whatIf={{ isMode: state.isWhatIfMode }}
                winningLine={state.isWhatIfMode ? state.whatIfWinningLine : state.winningLine}
                forbiddenMoves={state.forbiddenMoves}
            />

            <div className="mt-4 flex flex-col items-center gap-2">
                <GameControls
                    state={state}
                    dispatch={dispatch}
                    replayGame={replayGame}
                />
            </div>
        </>
    );
};

export default GameArea;