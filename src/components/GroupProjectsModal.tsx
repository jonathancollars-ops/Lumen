import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeType, Subject, GroupProject, GroupTask } from '../types';
import { getThemeColors, getContrastTextColor } from '../theme';
import { StorageService } from '../services/storage';
import { generateId } from '../utils/id';
import * as Haptics from 'expo-haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  theme: ThemeType;
  subjects: Subject[];
}

export const GroupProjectsModal: React.FC<Props> = ({
  visible,
  onClose,
  theme,
  subjects
}) => {
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);

  const [projects, setProjects] = useState<GroupProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<GroupProject | null>(null);

  // New Project Form State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSubjectId, setNewSubjectId] = useState<string>('');
  const [newDeadline, setNewDeadline] = useState('');
  const [newMembersText, setNewMembersText] = useState('');

  // New Task Form State
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');

  useEffect(() => {
    if (visible) {
      loadProjects();
    }
  }, [visible, subjects]);

  const safeSubjects = Array.isArray(subjects) ? subjects.filter(Boolean) : [];

  const loadProjects = async () => {
    const data = await StorageService.getGroupProjects();
    const safeData = Array.isArray(data) ? data.filter(Boolean) : [];
    setProjects(safeData);
    if (selectedProject) {
      const refreshed = safeData.find(p => p.id === selectedProject.id);
      setSelectedProject(refreshed || null);
    }
  };

  const handleCreateProject = async () => {
    if (!newTitle.trim() || !newSubjectId) {
      Alert.alert('Erro', 'Preencha o título do trabalho e selecione uma matéria.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const members = newMembersText
      .split(',')
      .map(m => m.trim())
      .filter(m => m.length > 0);

    if (!members.includes('Você')) {
      members.unshift('Você');
    }

    const newProj: GroupProject = {
      id: generateId('proj'),
      subjectId: newSubjectId,
      title: newTitle.trim(),
      deadline: newDeadline.trim() || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      members,
      tasks: [],
    };

    const updated = [newProj, ...projects];
    setProjects(updated);
    await StorageService.saveGroupProjects(updated);

    // Reset Form
    setNewTitle('');
    setNewDeadline('');
    setNewMembersText('');
    setShowCreateModal(false);
    setSelectedProject(newProj);
  };

  const handleAddTask = async () => {
    if (!selectedProject || !newTaskTitle.trim()) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const newTask: GroupTask = {
      id: generateId('task'),
      title: newTaskTitle.trim(),
      assignedTo: newTaskAssignee || 'Você',
      status: 'todo',
    };

    const currentTasks = Array.isArray(selectedProject.tasks) ? selectedProject.tasks : [];
    const updatedProject: GroupProject = {
      ...selectedProject,
      tasks: [...currentTasks, newTask],
    };

    const updatedProjects = projects.map(p => p.id === selectedProject.id ? updatedProject : p);
    setProjects(updatedProjects);
    setSelectedProject(updatedProject);
    await StorageService.saveGroupProjects(updatedProjects);

    setNewTaskTitle('');
    setShowAddTask(false);
  };

  const handleMoveTaskStatus = async (taskId: string, currentStatus: 'todo' | 'doing' | 'done') => {
    if (!selectedProject) return;

    Haptics.selectionAsync();

    const nextStatus: 'todo' | 'doing' | 'done' =
      currentStatus === 'todo' ? 'doing' : currentStatus === 'doing' ? 'done' : 'todo';

    const currentTasks = Array.isArray(selectedProject.tasks) ? selectedProject.tasks : [];
    const updatedTasks = currentTasks.map(t =>
      t.id === taskId ? { ...t, status: nextStatus } : t
    );

    const updatedProject: GroupProject = {
      ...selectedProject,
      tasks: updatedTasks,
    };

    const updatedProjects = projects.map(p => p.id === selectedProject.id ? updatedProject : p);
    setProjects(updatedProjects);
    setSelectedProject(updatedProject);
    await StorageService.saveGroupProjects(updatedProjects);

    // Give XP if task moved to 'done'
    if (nextStatus === 'done') {
      await StorageService.addXP(30);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!selectedProject) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    const currentTasks = Array.isArray(selectedProject.tasks) ? selectedProject.tasks : [];
    const updatedTasks = currentTasks.filter(t => t.id !== taskId);
    const updatedProject: GroupProject = {
      ...selectedProject,
      tasks: updatedTasks,
    };

    const updatedProjects = projects.map(p => p.id === selectedProject.id ? updatedProject : p);
    setProjects(updatedProjects);
    setSelectedProject(updatedProject);
    await StorageService.saveGroupProjects(updatedProjects);
  };

  const handleDeleteProject = (projId: string) => {
    Alert.alert('Excluir Trabalho', 'Deseja excluir este trabalho em grupo e todas as tarefas vinculadas?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          const updated = projects.filter(p => p.id !== projId);
          setProjects(updated);
          setSelectedProject(null);
          await StorageService.saveGroupProjects(updated);
        }
      }
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          {selectedProject ? (
            <TouchableOpacity
              onPress={() => setSelectedProject(null)}
              style={styles.backBtn}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 20, color: colors.primary, marginRight: 2 }}>‹</Text>
              <Text style={{ fontSize: 15, color: colors.primary, fontWeight: '700' }}>Trabalhos</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Text style={{ fontSize: 15, color: colors.primary, fontWeight: '700' }}>✕ Fechar</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.headerTitle} numberOfLines={1}>
            {selectedProject ? selectedProject.title : 'Trabalhos em Grupo'}
          </Text>

          {selectedProject ? (
            <TouchableOpacity
              onPress={() => handleDeleteProject(selectedProject.id)}
              style={styles.actionHeaderBtn}
              activeOpacity={0.7}
            >
              <Text style={{ color: theme === 'light' ? colors.dangerDark : colors.danger, fontWeight: '700', fontSize: 13 }}>Excluir</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          {!selectedProject ? (
            /* Projects List View */
            <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Create Project Button */}
            <TouchableOpacity
              style={[styles.createProjBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                if (subjects.length > 0) setNewSubjectId(subjects[0].id);
                setShowCreateModal(true);
              }}
              activeOpacity={0.8}
            >
              <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 15 }}>
                + Novo Trabalho em Grupo
              </Text>
            </TouchableOpacity>

            {projects.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 36, marginBottom: 10 }}>👥</Text>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>Nenhum trabalho em grupo cadastrado</Text>
                <Text style={{ color: colors.textSecondary, textAlign: 'center', fontSize: 13, marginTop: 4, lineHeight: 18 }}>
                  Crie um trabalho para organizar entregas, dividir tarefas entre colegas e acompanhar o progresso em um quadro Kanban.
                </Text>
              </View>
            ) : (
              projects.map(proj => {
                const sub = safeSubjects.find(s => s.id === proj.subjectId);
                const projTasks = Array.isArray(proj.tasks) ? proj.tasks.filter(Boolean) : [];
                const totalTasks = projTasks.length;
                const doneTasks = projTasks.filter(t => t.status === 'done').length;
                const percent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
                const subColor = sub?.color || colors.primary;

                return (
                  <TouchableOpacity
                    key={proj.id}
                    style={[styles.projectCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    onPress={() => setSelectedProject(proj)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <View style={{ flex: 1, marginRight: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                          <View style={[styles.subjectDot, { backgroundColor: subColor }]} />
                          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700' }}>
                            {sub?.name || 'Geral'}
                          </Text>
                        </View>
                        <Text style={[styles.projectTitle, { color: colors.text }]} numberOfLines={1}>
                          {proj.title}
                        </Text>
                      </View>

                      <View style={[styles.percentBadge, { backgroundColor: percent === 100 ? colors.successLight : colors.surfaceSubtle }]}>
                        <Text style={{ color: percent === 100 ? (theme === 'light' ? colors.successDark : colors.success) : colors.primary, fontWeight: '800', fontSize: 13 }}>
                          {percent}%
                        </Text>
                      </View>
                    </View>

                    {/* Progress Track */}
                    <View style={[styles.progressTrack, { backgroundColor: colors.surfaceSubtle }]}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${percent}%`,
                            backgroundColor: percent === 100 ? colors.success : subColor
                          }
                        ]}
                      />
                    </View>

                    {/* Footer Info */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        👥 {Array.isArray(proj.members) ? proj.members.join(', ') : ''}
                      </Text>
                      <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>
                        📅 Entrega: {proj.deadline ? proj.deadline.split('-').reverse().join('/') : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}

            {/* Create Project Modal */}
            {showCreateModal && (
              <View style={[styles.formModalCard, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
                <Text style={[styles.formModalTitle, { color: colors.text }]}>Novo Trabalho em Grupo</Text>

                <Text style={styles.inputLabel}>Título do Trabalho</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                  placeholder="Ex: Artigo de Pesquisa, Seminário Final"
                  placeholderTextColor={colors.textSecondary}
                  value={newTitle}
                  onChangeText={setNewTitle}
                />

                <Text style={styles.inputLabel}>Matéria</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  {safeSubjects.map(sub => {
                    const isSelected = newSubjectId === sub.id;
                    return (
                      <TouchableOpacity
                        key={sub.id}
                        style={[
                          styles.subChip,
                          {
                            backgroundColor: isSelected ? sub.color || colors.primary : colors.surfaceSubtle,
                            borderColor: isSelected ? sub.color || colors.primary : colors.border,
                            borderWidth: 1
                          }
                        ]}
                        onPress={() => setNewSubjectId(sub.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: isSelected ? getContrastTextColor(sub.color || colors.primary) : colors.text, fontWeight: '700', fontSize: 12 }}>
                          {sub.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <Text style={styles.inputLabel}>Membros da Equipe (separados por vírgula)</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                  placeholder="Ex: Lucas, Ana, Pedro"
                  placeholderTextColor={colors.textSecondary}
                  value={newMembersText}
                  onChangeText={setNewMembersText}
                />

                <Text style={styles.inputLabel}>Data de Entrega Final (YYYY-MM-DD)</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                  placeholder="Ex: 2026-06-15"
                  placeholderTextColor={colors.textSecondary}
                  value={newDeadline}
                  onChangeText={setNewDeadline}
                />

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <TouchableOpacity
                    style={[styles.formBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border, borderWidth: 1 }]}
                    onPress={() => setShowCreateModal(false)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.formBtn, { backgroundColor: colors.primary, flex: 2 }]}
                    onPress={handleCreateProject}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800' }}>Criar Trabalho</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          /* Single Project Kanban View */
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Project Header Info */}
            <View style={[styles.projectDetailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={[styles.detailsTitle, { color: colors.text }]}>{selectedProject.title}</Text>
                <View style={[styles.deadlineBadge, { backgroundColor: colors.primaryLight }]}>
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>
                    📅 {selectedProject.deadline ? selectedProject.deadline.split('-').reverse().join('/') : ''}
                  </Text>
                </View>
              </View>

              {/* Members Avatars */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {(Array.isArray(selectedProject.members) ? selectedProject.members : []).map(member => (
                  <View key={member} style={[styles.memberBadge, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>👤 {member}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Add Task Button */}
            <TouchableOpacity
              style={[styles.addTaskBtn, { backgroundColor: colors.surface, borderColor: colors.primary }]}
              onPress={() => {
                if (Array.isArray(selectedProject.members) && selectedProject.members.length > 0) {
                  setNewTaskAssignee(selectedProject.members[0]);
                }
                setShowAddTask(!showAddTask);
              }}
              activeOpacity={0.8}
            >
              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 14 }}>
                {showAddTask ? '✕ Cancelar Nova Tarefa' : '+ Adicionar Tarefa ao Quadro'}
              </Text>
            </TouchableOpacity>

            {/* Add Task Form */}
            {showAddTask && (
              <View style={[styles.taskFormCard, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
                <Text style={[styles.formModalTitle, { color: colors.text }]}>Nova Tarefa</Text>

                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                  placeholder="Ex: Escrever introdução, Fazer slides"
                  placeholderTextColor={colors.textSecondary}
                  value={newTaskTitle}
                  onChangeText={setNewTaskTitle}
                />

                <Text style={styles.inputLabel}>Responsável:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  {(Array.isArray(selectedProject.members) ? selectedProject.members : []).map(m => {
                    const isSelected = newTaskAssignee === m;
                    return (
                      <TouchableOpacity
                        key={m}
                        style={[
                          styles.subChip,
                          {
                            backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle,
                            borderColor: isSelected ? colors.primary : colors.border,
                            borderWidth: 1
                          }
                        ]}
                        onPress={() => setNewTaskAssignee(m)}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: isSelected ? getContrastTextColor(colors.primary) : colors.text, fontWeight: '700', fontSize: 12 }}>
                          {m}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <TouchableOpacity
                  style={[styles.saveTaskBtn, { backgroundColor: colors.primary }]}
                  onPress={handleAddTask}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 14 }}>
                    ✓ Adicionar Tarefa
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 3 Kanban Columns */}
            {(['todo', 'doing', 'done'] as const).map(columnStatus => {
              const projectTasks = Array.isArray(selectedProject.tasks) ? selectedProject.tasks.filter(Boolean) : [];
              const columnTasks = projectTasks.filter(t => t.status === columnStatus);
              const columnLabel =
                columnStatus === 'todo' ? '📌 A Fazer' : columnStatus === 'doing' ? '⏳ Em Andamento' : '✅ Concluído';
              const columnColor =
                columnStatus === 'todo'
                  ? colors.textSecondary
                  : columnStatus === 'doing'
                  ? (theme === 'light' ? colors.warningDark : colors.warning)
                  : (theme === 'light' ? colors.successDark : colors.success);

              return (
                <View key={columnStatus} style={styles.kanbanColumn}>
                  <View style={styles.columnHeader}>
                    <Text style={[styles.columnTitle, { color: columnColor }]}>
                      {columnLabel} ({columnTasks.length})
                    </Text>
                  </View>

                  {columnTasks.length === 0 ? (
                    <View style={[styles.emptyColumnCard, { backgroundColor: colors.surfaceSubtle }]}>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, fontStyle: 'italic' }}>
                        Nenhuma tarefa nesta etapa
                      </Text>
                    </View>
                  ) : (
                    columnTasks.map(task => (
                      <View
                        key={task.id}
                        style={[
                          styles.taskCard,
                          {
                            backgroundColor: colors.surface,
                            borderColor: columnStatus === 'done' ? colors.successLight : colors.border
                          }
                        ]}
                      >
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={[styles.taskTitle, { color: colors.text, textDecorationLine: columnStatus === 'done' ? 'line-through' : 'none' }]}>
                            {task.title}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                            <View style={[styles.assigneePill, { backgroundColor: colors.surfaceSubtle }]}>
                              <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>
                                👤 {task.assignedTo}
                              </Text>
                            </View>
                          </View>
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <TouchableOpacity
                            style={[styles.moveBtn, { backgroundColor: colors.surfaceSubtle }]}
                            onPress={() => handleMoveTaskStatus(task.id, task.status)}
                            activeOpacity={0.7}
                          >
                            <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '800' }}>
                              {columnStatus === 'todo' ? '▶ Iniciar' : columnStatus === 'doing' ? '✓ Concluir' : '↺ Voltar'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={() => handleDeleteTask(task.id)}
                            style={{ padding: 4 }}
                            activeOpacity={0.7}
                          >
                            <Text style={{ color: theme === 'light' ? colors.dangerDark : colors.danger, fontSize: 12, fontWeight: '800' }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              );
            })}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const getStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 85,
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  actionHeaderBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
    flex: 1,
    textAlign: 'center',
  },
  content: {
    padding: 18,
  },
  createProjBtn: {
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyCard: {
    padding: 30,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  projectCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  subjectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  projectTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  percentBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  formModalCard: {
    padding: 18,
    borderRadius: 18,
    borderWidth: 1.5,
    marginTop: 10,
    marginBottom: 20,
  },
  formModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    height: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  subChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    marginRight: 8,
  },
  formBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  projectDetailsCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
  },
  detailsTitle: {
    fontSize: 18,
    fontWeight: '800',
    flex: 1,
    marginRight: 10,
  },
  deadlineBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  memberBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
  },
  addTaskBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 14,
  },
  taskFormCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
  },
  saveTaskBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  kanbanColumn: {
    marginBottom: 16,
  },
  columnHeader: {
    marginBottom: 8,
  },
  columnTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  emptyColumnCard: {
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  assigneePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  moveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  }
});
