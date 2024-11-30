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
  where, 
  addDoc, 
  serverTimestamp, 
  Timestamp, 
  writeBatch, 
  getDocs 
} from 'firebase/firestore';
import moment from 'moment';
import 'moment/locale/fr';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';
import TransactionForm from '../components/TransactionForm';
import { useNavigate } from 'react-router-dom';
import { PencilIcon, TrashIcon, FunnelIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

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

  useEffect(() => {
    if (!currentUser) return;

    const transactionsRef = collection(db, 'users', currentUser.uid, 'transactions');
    const q = query(
      transactionsRef,
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newTransactions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: doc.data().date.toDate()
      }));

      setTransactions(newTransactions);
      
      // Initialiser les dates de filtrage
      if (newTransactions.length > 0) {
        const dates = newTransactions.map(t => t.date);
        const oldestDate = moment(Math.min(...dates)).format('YYYY-MM-DD');
        const futurestDate = moment(Math.max(...dates)).format('YYYY-MM-DD');
        
        setFilters(prev => ({
          ...prev,
          startDate: prev.startDate || oldestDate,
          endDate: prev.endDate || futurestDate
        }));
      }
      
      // Calculer les soldes actuel et futur
      const now = new Date();
      let currentBalance = 0;
      let futureBalance = 0;

      newTransactions.forEach(transaction => {
        const amount = transaction.amount || 0;
        const transactionAmount = transaction.type === 'income' ? amount : -amount;
        
        if (moment(transaction.date).isAfter(now)) {
          futureBalance += transactionAmount;
        }
        currentBalance += transactionAmount;
      });

      setBalances({
        current: currentBalance,
        future: currentBalance + futureBalance
      });
      
      // Calculer les statistiques mensuelles
      const currentMonthStart = moment(now).startOf('month').toDate();
      const currentMonthEnd = moment(now).endOf('month').toDate();
      const previousMonthStart = moment(now).subtract(1, 'month').startOf('month').toDate();
      const previousMonthEnd = moment(now).subtract(1, 'month').endOf('month').toDate();
      
      const currentMonthStats = {
        income: 0,
        expenses: 0
      };
      
      const previousMonthStats = {
        income: 0,
        expenses: 0
      };

      newTransactions.forEach(transaction => {
        const amount = transaction.amount || 0;
        const transactionDate = transaction.date;
        
        // Vérifier si la transaction est dans le mois actuel
        if (moment(transactionDate).isSame(currentMonthStart, 'month')) {
          if (transaction.type === 'income') {
            currentMonthStats.income += amount;
          } else if (transaction.type === 'expense') {
            currentMonthStats.expenses += amount;
          }
        }
        // Vérifier si la transaction est dans le mois précédent
        else if (moment(transactionDate).isSame(previousMonthStart, 'month')) {
          if (transaction.type === 'income') {
            previousMonthStats.income += amount;
          } else if (transaction.type === 'expense') {
            previousMonthStats.expenses += amount;
          }
        }
      });

      setMonthlyStats({
        currentMonth: currentMonthStats,
        previousMonth: previousMonthStats
      });

      setLoading(false);
    }, (error) => {
      console.error("Erreur lors de la récupération des transactions:", error);
      toast.error("Erreur lors de la récupération des transactions");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    let filtered = [...transactions];

    // Filtre par recherche
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      filtered = filtered.filter(t => 
        t.description.toLowerCase().includes(query)
      );
    }

    // Filtre par date
    if (filters.startDate) {
      const startDate = new Date(filters.startDate);
      filtered = filtered.filter(t => moment(t.date).isSameOrAfter(startDate));
    }
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999); // Inclure toute la journée
      filtered = filtered.filter(t => moment(t.date).isSameOrBefore(endDate));
    }

    if (filters.type !== 'all') {
      filtered = filtered.filter(t => t.type === filters.type);
    }
    if (filters.minAmount) {
      filtered = filtered.filter(t => t.amount >= parseFloat(filters.minAmount));
    }
    if (filters.maxAmount) {
      filtered = filtered.filter(t => t.amount <= parseFloat(filters.maxAmount));
    }

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

  const handleEditTransaction = (transaction) => {
    setSelectedTransaction(transaction);
    setIsTransactionModalOpen(true);
  };

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

  const handleCloseModal = () => {
    setIsTransactionModalOpen(false);
    setSelectedTransaction(null);
  };

  // Fonction pour grouper les transactions
  const groupTransactionsByDate = (transactions) => {
    moment.locale('fr'); // S'assurer que moment est en français
    
    const grouped = transactions.reduce((acc, transaction) => {
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

  const updateFilterDates = (transactions) => {
    if (transactions.length > 0) {
      const dates = transactions.map(t => t.date);
      const oldestDate = moment(Math.min(...dates)).format('YYYY-MM-DD');
      const futurestDate = moment(Math.max(...dates)).format('YYYY-MM-DD');
      
      setFilters(prev => ({
        ...prev,
        startDate: oldestDate,
        endDate: futurestDate
      }));
    } else {
      setFilters(prev => ({
        ...prev,
        startDate: '',
        endDate: ''
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!amount || !date) {
      toast.error('Veuillez remplir le montant et la date');
      return;
    }

    try {
      const transactionData = {
        description: description || 'Sans description',
        amount: parseFloat(amount),
        type,
        date: Timestamp.fromDate(new Date(date)),
        createdAt: serverTimestamp(),
      };

      if (isRecurring) {
        transactionData.recurring = {
          interval: recurrenceInterval,
          frequency: parseInt(recurrenceFrequency),
          endDate: recurrenceEndDate ? Timestamp.fromDate(new Date(recurrenceEndDate)) : null,
          useLastDayOfMonth,
          initialDate: Timestamp.fromDate(new Date(date))
        };

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
              ...transactionData.recurring,
              isRecurrence: true
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
        
        updateFilterDates([...transactions, ...transactions]); // Mettre à jour les dates après l'ajout
        toast.success(`${transactions.length} transactions récurrentes ajoutées avec succès`);
      } else {
        await addDoc(collection(db, 'users', currentUser.uid, 'transactions'), transactionData);
        const newDate = new Date(date);
        updateFilterDates([...transactions, { date: newDate }]); // Mettre à jour les dates après l'ajout
        toast.success('Transaction ajoutée avec succès');
      }

      setDescription('');
      setAmount('');
      setDate(moment().format('YYYY-MM-DD'));
      setIsRecurring(false);
      setRecurrenceInterval('month');
      setRecurrenceFrequency(1);
      setRecurrenceEndDate(moment().add(1, 'year').format('YYYY-MM-DD'));
      setUseLastDayOfMonth(false);
    } catch (error) {
      console.error('Erreur lors de l\'ajout de la transaction:', error);
      toast.error('Erreur lors de l\'ajout de la transaction');
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
                setSelectedTransaction(null);
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

        

        

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Transactions récentes
                </h2>
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
                      <div key={day} className="space-y-2">
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
                                  onClick={() => handleEditTransaction(transaction)}
                                  className="p-2 text-gray-600 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 transition-colors"
                                  title="Modifier"
                                >
                                  <PencilIcon className="h-5 w-5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteTransaction(transaction.id)}
                                  className="p-2 text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
                                  title="Supprimer"
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
          title={selectedTransaction ? "Modifier la transaction" : "Nouvelle transaction"}
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
      </div>
    </div>
  );
}
