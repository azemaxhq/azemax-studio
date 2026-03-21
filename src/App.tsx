import { MainLayout } from './components/Layout/MainLayout';
import { ProjectProvider } from './context/ProjectContext';
import { TerminalProvider } from './context/TerminalContext';
import { ExplanationProvider } from './context/ExplanationContext';

function App() {
  return (
    <ProjectProvider>
      <TerminalProvider>
        <ExplanationProvider>
          <MainLayout />
        </ExplanationProvider>
      </TerminalProvider>
    </ProjectProvider>
  );
}

export default App;
