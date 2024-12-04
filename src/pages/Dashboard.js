import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  deleteDoc, 
  addDoc, 
  serverTimestamp, 
  Timestamp, 
  writeBatch, 
  getDocs,
  updateDoc
} from 'firebase/firestore';
import moment from 'moment';
import 'moment/locale/fr';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';
import BalanceChart from '../components/BalanceChart';
import { useNavigate } from 'react-router-dom';
import { PencilIcon, TrashIcon, FunnelIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { ChevronUpIcon, ChevronDownIcon, CalendarDaysIcon } from '@heroicons/react/24/solid';

export default function Dashboard() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState({
    current: 0,
    future: 0
  });
  const [monthlyStats, setMonthlyStats] = useState({
    currentMonth: { income: 0, expenses: 0 },
    previousMonth: { income: 0, expenses: 0 }
  });
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    type: 'all',
    minAmount: '',
    maxAmount: '',
    searchQuery: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [filteredTransactions, setFilteredTransactions] = useState([]);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showChart, setShowChart] = useState(true); // Nouvel état pour contrôler l'affichage du graphique
  const [isEditing, setIsEditing] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [showFutureTransactions, setShowFutureTransactions] = useState(false);
  const [showPastTransactions, setShowPastTransactions] = useState(false);
  const [showScrollButtons, setShowScrollButtons] = useState(false);
  const [monthCutoffDay, setMonthCutoffDay] = useState(26); // Jour de changement de mois par défaut

  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'users', currentUser.uid, 'transactions'),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const transactionsData = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data && data.date) {
          transactionsData.push({
            id: doc.id,
            ...data,
            date: data.date.toDate()
          });
        } else {
          console.warn(`Transaction ${doc.id} ignorée car la date est manquante ou invalide`);
        }
      });
      setTransactions(transactionsData);
      
      // Calculer les soldes
      const now = new Date();
      let currentBalance = 0;
      let futureBalance = 0;

      // Trier les transactions par date
      const sortedTransactions = [...transactionsData].sort((a, b) => a.date - b.date);

      sortedTransactions.forEach(transaction => {
        const amount = transaction.amount || 0;
        const transactionAmount = transaction.type === 'income' ? amount : -amount;
        const transactionDate = moment(transaction.date);
        const transactionAccountingMonth = getAccountingMonth(transactionDate);
        const currentAccountingMonth = getAccountingMonth(now);
        
        // Si la transaction est dans le futur selon le mois comptable
        if (transactionAccountingMonth.isAfter(currentAccountingMonth, 'month')) {
          futureBalance += transactionAmount;
        } else {
          // Sinon, l'ajouter au solde actuel
          currentBalance += transactionAmount;
        }
      });

      setBalances({
        current: currentBalance,
        future: currentBalance + futureBalance // Le solde futur inclut le solde actuel
      });

      // Calculer les statistiques mensuelles
      const currentAccountingMonth = getAccountingMonth(now);
      const previousAccountingMonth = moment(currentAccountingMonth).subtract(1, 'month');

      const currentMonthStats = {
        income: 0,
        expenses: 0
      };
      
      const previousMonthStats = {
        income: 0,
        expenses: 0
      };

      transactionsData.forEach(transaction => {
        const amount = transaction.amount || 0;
        const transactionDate = moment(transaction.date);
        const transactionAccountingMonth = getAccountingMonth(transactionDate);
        
        if (transactionAccountingMonth.isSame(currentAccountingMonth, 'month')) {
          if (transaction.type === 'income') {
            currentMonthStats.income += amount;
          } else {
            currentMonthStats.expenses += amount;
          }
        } else if (transactionAccountingMonth.isSame(previousAccountingMonth, 'month')) {
          if (transaction.type === 'income') {
            previousMonthStats.income += amount;
          } else {
            previousMonthStats.expenses += amount;
          }
        }
      });

      setMonthlyStats({
        currentMonth: currentMonthStats,
        previousMonth: previousMonthStats
      });
      
      if (transactionsData.length > 0) {
        updateFilterDates(transactionsData);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [monthCutoffDay]);

  useEffect(() => {
    const getFilteredTransactions = () => {
      return transactions.filter(transaction => {
        const transactionDate = moment(transaction.date);
        const startDate = filters.startDate ? moment(filters.startDate).startOf('day') : null;
        const endDate = filters.endDate ? moment(filters.endDate).endOf('day') : null;

        // Vérification des dates
        if (startDate && endDate) {
          const isInDateRange = transactionDate.isSameOrAfter(startDate, 'day') && 
                              transactionDate.isSameOrBefore(endDate, 'day');
          if (!isInDateRange) return false;
        }

        // Vérification du type
        if (filters.type !== 'all' && transaction.type !== filters.type) {
          return false;
        }

        // Obtenir le montant effectif (positif pour revenus, négatif pour dépenses)
        const effectiveAmount = transaction.type === 'expense' ? -transaction.amount : transaction.amount;

        // Vérification du montant minimum
        if (filters.minAmount) {
          const minAmount = parseFloat(filters.minAmount);
          if (transaction.type === 'expense') {
            // Pour les dépenses, comparer avec la valeur absolue
            if (Math.abs(effectiveAmount) < Math.abs(minAmount)) {
              return false;
            }
          } else {
            // Pour les revenus, comparer normalement
            if (effectiveAmount < minAmount) {
              return false;
            }
          }
        }

        // Vérification du montant maximum
        if (filters.maxAmount) {
          const maxAmount = parseFloat(filters.maxAmount);
          if (transaction.type === 'expense') {
            // Pour les dépenses, comparer avec la valeur absolue
            if (Math.abs(effectiveAmount) > Math.abs(maxAmount)) {
              return false;
            }
          } else {
            // Pour les revenus, comparer normalement
            if (effectiveAmount > maxAmount) {
              return false;
            }
          }
        }

        // Vérification de la recherche
        if (filters.searchQuery) {
          const searchLower = filters.searchQuery.toLowerCase();
          const descriptionLower = transaction.description.toLowerCase();
          if (!descriptionLower.includes(searchLower)) {
            return false;
          }
        }

        return true;
      });
    };

    let filtered = getFilteredTransactions();

    setFilteredTransactions(filtered);
  }, [transactions, filters]);

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Déconnexion réussie');
      navigate('/login');
    } catch (error) {
      toast.error('Erreur lors de la déconnexion');
    }
  };

  const handleEditClick = (transaction) => {
    setIsEditing(true);
    setEditingTransaction(transaction);
    setDescription(transaction.description);
    setAmount(transaction.amount.toString());
    setType(transaction.type);
    setDate(moment(transaction.date).format('YYYY-MM-DD'));
    setIsTransactionModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!amount || !date) {
      toast.error('Veuillez remplir le montant et la date');
      return;
    }

    try {
      if (isEditing && editingTransaction) {
        // Mode édition
        const transactionRef = doc(db, 'users', currentUser.uid, 'transactions', editingTransaction.id);
        
        const updatedData = {
          description: description || 'Sans description',
          amount: parseFloat(amount),
          type,
          date: Timestamp.fromDate(new Date(date)),
          updatedAt: serverTimestamp()
        };

        await updateDoc(transactionRef, updatedData);
        toast.success('Transaction modifiée avec succès');
        
        // Réinitialisation immédiate après la mise à jour
        setDescription('');
        setAmount('');
        setDate(moment().format('YYYY-MM-DD'));
        setType('expense');
        setIsEditing(false);
        setEditingTransaction(null);
        setIsTransactionModalOpen(false); // Ferme le modal
      } else {
        // Mode ajout
        const transactionData = {
          description: description || 'Sans description',
          amount: parseFloat(amount),
          type,
          date: Timestamp.fromDate(new Date(date)),
          createdAt: serverTimestamp(),
        };

        if (isRecurring) {
          // Créer les transactions récurrentes jusqu'à la date de fin
          let currentDate = new Date(date);
          const initialDate = new Date(date);
          const endDate = recurrenceEndDate ? new Date(recurrenceEndDate) : moment().add(1, 'year').toDate();
          const transactions = [];

          while (currentDate <= endDate) {
            const recurringTransaction = {
              ...transactionData,
              date: Timestamp.fromDate(currentDate),
              recurring: {
                interval: recurrenceInterval,
                frequency: parseInt(recurrenceFrequency),
                endDate: recurrenceEndDate ? Timestamp.fromDate(new Date(recurrenceEndDate)) : null,
                useLastDayOfMonth,
                initialDate: Timestamp.fromDate(new Date(date))
              }
            };

            transactions.push(recurringTransaction);

            currentDate = calculateNextDate(
              currentDate,
              recurrenceInterval,
              parseInt(recurrenceFrequency),
              initialDate,
              useLastDayOfMonth
            );
          }

          // Utiliser une opération batch pour ajouter toutes les transactions en une fois
          const batch = writeBatch(db);
          
          transactions.forEach(transaction => {
            const newTransactionRef = doc(collection(db, 'users', currentUser.uid, 'transactions'));
            batch.set(newTransactionRef, transaction);
          });

          // Exécuter le batch
          await batch.commit();
          
          // Fermer le modal et réinitialiser les champs
          handleCloseModal();
          
          // Attendre que les transactions soient chargées avant de réinitialiser les filtres
          // reset les fitres de date 
          setFilters({
            startDate: '',
            endDate: '',
            type: 'all',
            minAmount: '',
            maxAmount: '',
            searchQuery: ''
          });
          toast.success(`${transactions.length} transactions récurrentes ajoutées avec succès`);
        } else {
          await addDoc(collection(db, 'users', currentUser.uid, 'transactions'), transactionData);
          const newDate = new Date(date);
          updateFilterDates([...transactions, { date: newDate }]);
          handleCloseModal();
          toast.success('Transaction ajoutée avec succès');
        }
      }

      // Réinitialisation des champs
      setIsRecurring(false);
      setRecurrenceInterval('month');
      setRecurrenceFrequency(1);
      setRecurrenceEndDate(moment().add(1, 'year').format('YYYY-MM-DD'));
      setUseLastDayOfMonth(false);
    } catch (error) {
      console.error('Erreur lors de l\'opération:', error);
      toast.error(isEditing ? 'Erreur lors de la modification' : 'Erreur lors de l\'ajout');
    }
  };

  const handleCloseModal = () => {
    setIsTransactionModalOpen(false);
    setDescription('');
    setAmount('');
    setDate(moment().format('YYYY-MM-DD'));
    setType('expense');
    setIsEditing(false);
    setEditingTransaction(null);
    setIsRecurring(false);
    setRecurrenceInterval('month');
    setRecurrenceFrequency(1);
    setRecurrenceEndDate(moment().add(1, 'year').format('YYYY-MM-DD'));
    setUseLastDayOfMonth(false);
  };

  // Fonction pour déterminer le mois comptable d'une date
  const getAccountingMonth = (date) => {
    const day = moment(date).date();
    if (day >= monthCutoffDay) {
      return moment(date).add(1, 'month').startOf('month');
    }
    return moment(date).startOf('month');
  };

  // Modifier la fonction groupTransactionsByDate
  const groupTransactionsByDate = (transactions) => {
    moment.locale('fr');
    
    // Calculer les mois comptables
    const today = moment();
    const currentAccountingMonth = getAccountingMonth(today);
    const nextAccountingMonth = moment(currentAccountingMonth).add(1, 'month');
    const previousAccountingMonth = moment(currentAccountingMonth).subtract(1, 'month');

    const filteredTransactions = transactions.filter(transaction => {
      const transactionDate = moment(transaction.date);
      const transactionAccountingMonth = getAccountingMonth(transactionDate);
      
      // Transactions du mois comptable en cours
      if (transactionAccountingMonth.isSame(currentAccountingMonth, 'month')) {
        return true;
      }
      
      // Transactions du mois comptable suivant
      if (transactionAccountingMonth.isSame(nextAccountingMonth, 'month')) {
        return showFutureTransactions;
      }
      
      // Transactions du mois comptable précédent
      if (transactionAccountingMonth.isSame(previousAccountingMonth, 'month')) {
        return showPastTransactions;
      }
      
      // Autres transactions plus anciennes ou futures
      if (transactionAccountingMonth.isBefore(previousAccountingMonth, 'month')) {
        return showPastTransactions;
      }
      if (transactionAccountingMonth.isAfter(nextAccountingMonth, 'month')) {
        return showFutureTransactions;
      }
      
      return true;
    });

    const grouped = filteredTransactions.reduce((acc, transaction) => {
      const monthKey = moment(transaction.date).format('MMMM YYYY');
      const dayKey = moment(transaction.date).format('D MMMM YYYY');
      
      if (!acc[monthKey]) {
        acc[monthKey] = {
          total: 0,
          days: {}
        };
      }
      
      if (!acc[monthKey].days[dayKey]) {
        acc[monthKey].days[dayKey] = {
          transactions: [],
          total: 0
        };
      }
      
      acc[monthKey].days[dayKey].transactions.push(transaction);
      acc[monthKey].days[dayKey].total += transaction.type === 'income' ? transaction.amount : -transaction.amount;
      acc[monthKey].total += transaction.type === 'income' ? transaction.amount : -transaction.amount;
      
      return acc;
    }, {});
    
    return grouped;
  };

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('expense');
  const [date, setDate] = useState(moment().format('YYYY-MM-DD'));
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState('month');
  const [recurrenceFrequency, setRecurrenceFrequency] = useState(1);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(moment().add(1, 'year').format('YYYY-MM-DD'));
  const [useLastDayOfMonth, setUseLastDayOfMonth] = useState(false);

  const calculateNextDate = (currentDate, interval, frequency, initialDate, useLastDay) => {
    const momentDate = moment(currentDate);
    const originalDay = moment(initialDate).date();
    const isLastDayOfMonth = moment(initialDate).endOf('month').date() === originalDay;

    switch (interval) {
      case 'day':
        return momentDate.add(frequency, 'days').toDate();
      case 'week':
        return momentDate.add(frequency, 'weeks').toDate();
      case 'month':
        const nextDate = momentDate.add(frequency, 'months');
        const daysInMonth = nextDate.daysInMonth();
        
        if (originalDay === 30 || isLastDayOfMonth) {
          if (useLastDay) {
            // Si on veut utiliser le dernier jour du mois
            nextDate.endOf('month');
          } else {
            // Sinon on essaie de garder le jour 30 quand possible
            if (originalDay > daysInMonth) {
              nextDate.date(daysInMonth);
            } else {
              nextDate.date(originalDay);
            }
          }
        } else {
          // Pour les autres jours, comportement normal
          if (originalDay > daysInMonth) {
            nextDate.date(daysInMonth);
          } else {
            nextDate.date(originalDay);
          }
        }
        
        return nextDate.toDate();
      case 'year':
        return momentDate.add(frequency, 'years').toDate();
      default:
        return momentDate.toDate();
    }
  };

  // Modifier la fonction updateFilterDates
  const updateFilterDates = (transactions) => {
    if (!transactions || transactions.length === 0) return;

    const today = moment();
    const currentAccountingMonth = getAccountingMonth(today);
    const nextAccountingMonth = moment(currentAccountingMonth).add(1, 'month');
    const previousAccountingMonth = moment(currentAccountingMonth).subtract(1, 'month');

    const visibleTransactions = transactions.filter(transaction => {
      const transactionDate = moment(transaction.date);
      const transactionAccountingMonth = getAccountingMonth(transactionDate);
      
      // Transactions du mois comptable en cours
      if (transactionAccountingMonth.isSame(currentAccountingMonth, 'month')) {
        return true;
      }
      
      // Transactions du mois comptable suivant
      if (transactionAccountingMonth.isSame(nextAccountingMonth, 'month')) {
        return showFutureTransactions;
      }
      
      // Transactions du mois comptable précédent
      if (transactionAccountingMonth.isSame(previousAccountingMonth, 'month')) {
        return showPastTransactions;
      }
      
      // Autres transactions plus anciennes ou futures
      if (transactionAccountingMonth.isBefore(previousAccountingMonth, 'month')) {
        return showPastTransactions;
      }
      if (transactionAccountingMonth.isAfter(nextAccountingMonth, 'month')) {
        return showFutureTransactions;
      }
      
      return true;
    });

    if (visibleTransactions.length === 0) {
      setFilters(prev => ({
        ...prev,
        startDate: '',
        endDate: ''
      }));
      return;
    }

    const validTransactions = visibleTransactions.filter(t => t.date instanceof Date);
    if (validTransactions.length === 0) return;

    const dates = validTransactions.map(t => new Date(t.date));
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    setFilters(prev => ({
      ...prev,
      startDate: moment(minDate).format('YYYY-MM-DD'),
      endDate: moment(maxDate).format('YYYY-MM-DD')
    }));
  };

  // Ajouter un composant de configuration pour le jour de changement de mois
  const MonthCutoffSetting = () => (
    <div className="mb-4 flex items-center gap-4">
      <label htmlFor="monthCutoffDay" className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Jour de changement de mois :
      </label>
      <input
        type="number"
        id="monthCutoffDay"
        min="1"
        max="31"
        value={monthCutoffDay}
        onChange={(e) => setMonthCutoffDay(parseInt(e.target.value, 10))}
        className="w-20 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
      />
    </div>
  );

  // Ajouter un effet pour mettre à jour les filtres quand les préférences d'affichage changent
  useEffect(() => {
    if (transactions.length > 0) {
      updateFilterDates(transactions);
    }
  }, [showPastTransactions, showFutureTransactions, transactions]);

  const handleDeleteTransaction = async (transactionId) => {
    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'transactions', transactionId));
      
      // Créer un tableau des transactions restantes après la suppression
      const remainingTransactions = transactions.filter(t => t.id !== transactionId);
      updateFilterDates(remainingTransactions);
      
      toast.success('Transaction supprimée avec succès');
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      toast.error('Erreur lors de la suppression de la transaction');
    }
  };

  const deleteAllTransactions = async () => {
    try {
      const batch = writeBatch(db);
      const transactionsRef = collection(db, 'users', currentUser.uid, 'transactions');
      const snapshot = await getDocs(transactionsRef);
      
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      
      updateFilterDates([]); // Réinitialiser les dates des filtres car il n'y a plus de transactions
      
      toast.success('Toutes les transactions ont été supprimées');
      setIsDeleteModalOpen(false);
    } catch (error) {
      console.error('Erreur lors de la suppression des transactions:', error);
      toast.error('Erreur lors de la suppression des transactions');
    }
  };

  const deleteFilteredTransactions = async () => {
    try {
      setIsDeleting(true);
      
      if (filteredTransactions.length === 0) {
        toast.error('Aucune transaction à supprimer');
        setIsDeleting(false);
        return;
      }

      const batch = writeBatch(db);
      
      // Créer un tableau des transactions restantes
      const remainingTransactions = transactions.filter(
        t => !filteredTransactions.some(ft => ft.id === t.id)
      );

      filteredTransactions.forEach(transaction => {
        const docRef = doc(db, 'users', currentUser.uid, 'transactions', transaction.id);
        batch.delete(docRef);
      });

      await batch.commit();
      
      updateFilterDates(remainingTransactions); // Mettre à jour les dates des filtres avec les transactions restantes
      
      setShowDeleteConfirmation(false);
      toast.success(`${filteredTransactions.length} transaction(s) supprimée(s) avec succès`);
    } catch (error) {
      console.error('Erreur lors de la suppression des transactions:', error);
      toast.error('Erreur lors de la suppression des transactions');
    } finally {
      setIsDeleting(false);
    }
  };

  const resetFilters = () => {
    if (transactions.length > 0) {
      const dates = transactions.map(t => t.date);
      const oldestDate = moment(Math.min(...dates)).format('YYYY-MM-DD');
      const futurestDate = moment(Math.max(...dates)).format('YYYY-MM-DD');
      
      setFilters({
        startDate: oldestDate,
        endDate: futurestDate,
        type: 'all',
        minAmount: '',
        maxAmount: '',
        searchQuery: ''
      });
    } else {
      setFilters({
        startDate: '',
        endDate: '',
        type: 'all',
        minAmount: '',
        maxAmount: '',
        searchQuery: ''
      });
    }
  };

  // Fonction pour détecter le scroll et afficher/masquer les boutons
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollButtons(window.scrollY > 200);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Fonction pour scroller en haut de la liste des transactions
  const scrollToTop = () => {
    const transactionsList = document.getElementById('transactions-list');
    if (transactionsList) {
      transactionsList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Fonction pour scroller en bas
  const scrollToBottom = () => {
    window.scrollTo({ 
      top: document.documentElement.scrollHeight,
      behavior: 'smooth'
    });
  };

  // Fonction pour scroller à la date la plus proche
  const scrollToCurrentDate = () => {
    const today = moment();
    const allDates = Array.from(document.querySelectorAll('[data-date]')).map(element => ({
      element,
      date: moment(element.getAttribute('data-date'), 'D MMMM YYYY'),
      diff: Math.abs(moment(element.getAttribute('data-date'), 'D MMMM YYYY').diff(today, 'days'))
    }));

    if (allDates.length > 0) {
      // Trier par différence avec aujourd'hui et prendre la plus proche
      const closestDate = allDates.reduce((prev, curr) => 
        prev.diff < curr.diff ? prev : curr
      );

      closestDate.element.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Tableau de bord
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Bienvenue, {currentUser?.email}
            </p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => {
                setIsEditing(false);
                setEditingTransaction(null);
                setIsTransactionModalOpen(true);
              }}
              className="btn-primary"
            >
              Nouvelle transaction
            </button>
            <button
              onClick={() => setIsDeleteModalOpen(true)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
            >
              Supprimer tout
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
            >
              Se déconnecter
            </button>
          </div>
        </div>

        {/* Ajouter le paramètre de configuration */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-4">
          <div className="flex items-center gap-4">
            <label htmlFor="monthCutoffDay" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Jour de changement de mois :
            </label>
            <input
              type="number"
              id="monthCutoffDay"
              min="1"
              max="31"
              value={monthCutoffDay}
              onChange={(e) => setMonthCutoffDay(parseInt(e.target.value, 10))}
              className="w-20 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              (Les transactions à partir de ce jour seront comptabilisées dans le mois suivant)
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Solde actuel
            </h2>
            <p className={`text-2xl font-bold ${balances.current >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {balances.current.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
            </p>
            <div className="mt-2">
              <p className="text-lg text-gray-600 dark:text-gray-400">Solde à venir : {balances.future.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className={balances.future >= balances.current ? 'text-green-600' : 'text-red-600'}>
                  {balances.future >= balances.current ? '▲' : '▼'}
                </span> {Math.abs(balances.future - balances.current).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} de variation
              </p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Revenus du mois
            </h2>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {monthlyStats.currentMonth.income.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
            </p>
            <div className="mt-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className={monthlyStats.currentMonth.income >= monthlyStats.previousMonth.income ? 'text-green-600' : 'text-red-600'}>
                  {monthlyStats.currentMonth.income >= monthlyStats.previousMonth.income ? '▲' : '▼'}
                </span> vs mois précédent ({Math.abs(monthlyStats.currentMonth.income - monthlyStats.previousMonth.income).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })})
              </p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Dépenses du mois
            </h2>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">
              {monthlyStats.currentMonth.expenses.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
            </p>
            <div className="mt-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className={monthlyStats.currentMonth.expenses <= monthlyStats.previousMonth.expenses ? 'text-green-600' : 'text-red-600'}>
                  {monthlyStats.currentMonth.expenses <= monthlyStats.previousMonth.expenses ? '▼' : '▲'}
                </span> vs mois précédent ({Math.abs(monthlyStats.currentMonth.expenses - monthlyStats.previousMonth.expenses).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })})
              </p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Balance mensuelle
            </h2>
            <p className={`text-2xl font-bold ${(monthlyStats.currentMonth.income - monthlyStats.currentMonth.expenses) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {(monthlyStats.currentMonth.income - monthlyStats.currentMonth.expenses).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
            </p>
            <div className="mt-2">
            <span className={`${(monthlyStats.currentMonth.income - monthlyStats.currentMonth.expenses) >= (monthlyStats.previousMonth.income - monthlyStats.previousMonth.expenses) ? 'text-green-600' : 'text-red-600'}`}>{(monthlyStats.currentMonth.income - monthlyStats.currentMonth.expenses) >= (monthlyStats.previousMonth.income - monthlyStats.previousMonth.expenses) ? '▲' : '▼'} {' '}</span>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Progression : {' '}
                  
                  {Math.abs(
                    (monthlyStats.currentMonth.income - monthlyStats.currentMonth.expenses) -
                    (monthlyStats.previousMonth.income - monthlyStats.previousMonth.expenses)
                  ).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
              </span>
            </div>
          </div>

        </div>

        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Graphique du solde
            </h2>
            <button
              onClick={() => setShowChart(!showChart)}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              {showChart ? 'Masquer le graphique' : 'Afficher le graphique'}
            </button>
          </div>
          {showChart && <BalanceChart transactions={filteredTransactions} />}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <div id="transactions-list" className="p-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Transactions récentes
                </h2>
                <div className="flex gap-4">
                  <button
                    onClick={() => setShowPastTransactions(!showPastTransactions)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  >
                    {showPastTransactions ? 'Masquer les opérations passées' : 'Afficher les opérations passées'}
                  </button>
                  <button
                    onClick={() => setShowFutureTransactions(!showFutureTransactions)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  >
                    {showFutureTransactions ? 'Masquer les opérations à venir' : 'Afficher les opérations à venir'}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Rechercher..."
                    value={filters.searchQuery}
                    onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
                    className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-800 dark:text-white"
                  />
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                </div>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  <FunnelIcon className="h-5 w-5" />
                  Filtres
                </button>
                <button
                  onClick={() => setShowDeleteConfirmation(true)}
                  className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
                >
                  Supprimer les transactions filtrées
                </button>
              </div>
            </div>

            {showFilters && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-8">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Filtres
                  </h2>
                  <button
                    onClick={resetFilters}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  >
                    Réinitialiser les filtres
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Date début
                    </label>
                    <input
                      type="date"
                      value={filters.startDate}
                      onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-800 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Date fin
                    </label>
                    <input
                      type="date"
                      value={filters.endDate}
                      onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-800 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Type
                    </label>
                    <select
                      value={filters.type}
                      onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value }))}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-800 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                    >
                      <option value="all">Tous</option>
                      <option value="income">Revenus</option>
                      <option value="expense">Dépenses</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Montant min
                    </label>
                    <input
                      type="number"
                      value={filters.minAmount}
                      onChange={(e) => setFilters(prev => ({ ...prev, minAmount: e.target.value }))}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-800 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Montant max
                    </label>
                    <input
                      type="number"
                      value={filters.maxAmount}
                      onChange={(e) => setFilters(prev => ({ ...prev, maxAmount: e.target.value }))}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-800 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {loading ? (
              <p className="text-gray-600 dark:text-gray-400">Chargement...</p>
            ) : filteredTransactions.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400">Aucune transaction</p>
            ) : (
              <div className="space-y-8">
                {Object.entries(groupTransactionsByDate(filteredTransactions)).map(([month, monthData]) => (
                  <div key={month} className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
                        {month}
                      </h3>
                      <span className={`font-semibold ${monthData.total >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {monthData.total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                      </span>
                    </div>
                    
                    {Object.entries(monthData.days).map(([day, dayData]) => (
                      <div key={day} className="space-y-2" data-date={day}>
                        <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 p-2 rounded-lg">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {day}
                          </span>
                          <span className={`text-sm font-medium ${dayData.total >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {dayData.total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                          </span>
                        </div>
                        
                        <div className="space-y-2 pl-4">
                          {dayData.transactions.map(transaction => (
                            <div
                              key={transaction.id}
                              className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            >
                              <div className="flex-grow">
                                <p className="font-semibold text-gray-900 dark:text-white">
                                  {transaction.description}
                                </p>
                              </div>
                              <div className="flex items-center gap-4">
                                <p className={`font-semibold ${
                                  transaction.type === 'income'
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-red-600 dark:text-red-400'
                                }`}>
                                  {(transaction.type === 'income' ? '+' : '-') + 
                                  transaction.amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                                </p>
                                <button
                                  onClick={() => handleEditClick(transaction)}
                                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
                                >
                                  <PencilIcon className="h-5 w-5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteTransaction(transaction.id)}
                                  className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                                >
                                  <TrashIcon className="h-5 w-5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>

        <Modal
          isOpen={isTransactionModalOpen}
          onClose={handleCloseModal}
          title={editingTransaction ? "Modifier la transaction" : "Nouvelle transaction"}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Description
              </label>
              <input
                type="text"
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
                placeholder="Description de la transaction"
              />
            </div>

            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Montant
              </label>
              <input
                type="number"
                id="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
                placeholder="0.00"
                step="0.01"
                min="0"
                required
              />
            </div>

            <div>
              <label htmlFor="type" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Type
              </label>
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
              >
                <option value="expense">Dépense</option>
                <option value="income">Revenu</option>
              </select>
            </div>

            <div>
              <label htmlFor="date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Date
              </label>
              <input
                type="date"
                id="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
                required
              />
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="isRecurring"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor="isRecurring" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                Transaction récurrente
              </label>
            </div>

            {isRecurring && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="recurrenceInterval" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Intervalle
                  </label>
                  <select
                    id="recurrenceInterval"
                    value={recurrenceInterval}
                    onChange={(e) => setRecurrenceInterval(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
                  >
                    <option value="day">Jour</option>
                    <option value="week">Semaine</option>
                    <option value="month">Mois</option>
                    <option value="year">Année</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="recurrenceFrequency" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Fréquence
                  </label>
                  <input
                    type="number"
                    id="recurrenceFrequency"
                    value={recurrenceFrequency}
                    onChange={(e) => setRecurrenceFrequency(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
                    min="1"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="recurrenceEndDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Date de fin (optionnel)
                  </label>
                  <input
                    type="date"
                    id="recurrenceEndDate"
                    value={recurrenceEndDate}
                    onChange={(e) => setRecurrenceEndDate(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
                    min={moment().add(1, 'day').format('YYYY-MM-DD')}
                  />
                </div>

                {recurrenceInterval === 'month' && moment(date).date() >= 28 && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="useLastDayOfMonth"
                      checked={useLastDayOfMonth}
                      onChange={(e) => setUseLastDayOfMonth(e.target.checked)}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <label htmlFor="useLastDayOfMonth" className="text-sm text-gray-700 dark:text-gray-300">
                      Utiliser le dernier jour de chaque mois
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setIsTransactionModalOpen(false)}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Ajouter
              </button>
            </div>
          </form>
        </Modal>

        <Modal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          title="Confirmer la suppression"
        >
          <div className="p-6">
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Êtes-vous sûr de vouloir supprimer toutes les transactions ? Cette action est irréversible.
            </p>
            <div className="flex justify-end gap-4">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={deleteAllTransactions}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
              >
                Supprimer tout
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={showDeleteConfirmation}
          onClose={() => setShowDeleteConfirmation(false)}
          title="Confirmer la suppression"
        >
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              Êtes-vous sûr de vouloir supprimer toutes les transactions {filters.type !== 'all' ? `de type ${filters.type}` : ''} 
              {filters.startDate ? ` pour ${moment(filters.startDate).format('MMMM YYYY')}` : ''} ?
              Cette action est irréversible.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirmation(false)}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                disabled={isDeleting}
              >
                Annuler
              </button>
              <button
                onClick={deleteFilteredTransactions}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                disabled={isDeleting}
              >
                {isDeleting ? 'Suppression...' : 'Confirmer la suppression'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Boutons de navigation fixes */}
        {showScrollButtons && (
          <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50">
            <button
              onClick={scrollToTop}
              className="p-3 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors"
              title="Aller en haut"
            >
              <ChevronUpIcon className="h-6 w-6" />
            </button>
            
            <button
              onClick={scrollToCurrentDate}
              className="p-3 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors"
              title="Aller à la date actuelle"
            >
              <CalendarDaysIcon className="h-6 w-6" />
            </button>
            
            <button
              onClick={scrollToBottom}
              className="p-3 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors"
              title="Aller en bas"
            >
              <ChevronDownIcon className="h-6 w-6" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
