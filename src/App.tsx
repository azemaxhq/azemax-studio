import { MainLayout } from './components/Layout/MainLayout';
import { ProjectProvider } from './context/ProjectContext';
import { TerminalProvider } from './context/TerminalContext';

function App() {
  return (
    <ProjectProvider>
      <TerminalProvider>
        <MainLayout />
      </TerminalProvider>
    </ProjectProvider>
  );
}

export default App;
